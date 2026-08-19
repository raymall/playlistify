-- Recipe snapshots: every parameter that shapes an enrichment answer lives on
-- the recipe row as a complete frozen snapshot — the system prompt text, the
-- identity fields the song line is built from, a bounded output spec, and a
-- frozen copy of the approved vocabulary. A content hash over all of it (plus
-- rank and the High opt-in, which recorded attempts depend on) is unique, so a
-- changed parameter mints a new row because the database refuses to file it as
-- the existing one — not because someone remembered to.
--
-- The three version labels (prompt_version, vocabulary_version,
-- identity_version) are dropped: they named things the database never held.
-- Their information survives in the recipe_key and label text of the legacy
-- rows.
--
-- Recipe rows stop being migration-seeded: `npm run recipe:sync` authors them
-- from recipes/definitions.ts. Existing rows are not backfilled — they keep
-- NULL snapshots and honestly say "no snapshot recorded" — and every row is
-- disabled here so the first sync mints snapshot-carrying replacements.

-- The frozen approved vocabulary a recipe ran with. Snapshots are shared:
-- recipes minted while the approved lists are unchanged reference one row.
create table public.vocabulary_snapshots (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) > 0),
  genre_names text[] not null,
  mood_names text[] not null,
  content_hash text unique not null
    check (char_length(btrim(content_hash)) > 0),
  created_at timestamptz not null default now()
);

-- Service-role only, like enrichment_recipes: RLS on, zero policies.
alter table public.vocabulary_snapshots enable row level security;

alter table public.enrichment_recipes
  add column system_prompt text,
  add column identity_fields text[],
  add column output_spec jsonb,
  add column vocabulary_snapshot_id uuid
    references public.vocabulary_snapshots (id) on delete restrict,
  add column content_hash text;

create unique index enrichment_recipes_content_hash_idx
  on public.enrichment_recipes (content_hash);

create index enrichment_recipes_vocabulary_snapshot_id_idx
  on public.enrichment_recipes (vocabulary_snapshot_id);

-- No backfill, by decision: the six pre-snapshot rows keep NULLs rather than
-- receiving reconstructed history. Disabling them here is what lets the CHECK
-- below hold; the first `recipe:sync` run activates their snapshot-carrying
-- replacements, and the next "Analyze & improve" retires their queued jobs
-- against the new default (retire_disabled_enrichment_jobs).
update public.enrichment_recipes
set enabled = false, is_default = false;

alter table public.enrichment_recipes
  drop column prompt_version,
  drop column vocabulary_version,
  drop column identity_version;

-- An enabled recipe must carry its complete snapshot. Nullable columns are how
-- "no backfill" is encoded; this keeps a NULL snapshot from being claimable.
alter table public.enrichment_recipes
  add constraint enrichment_recipes_enabled_snapshot check (
    not enabled or (
      system_prompt is not null
      and identity_fields is not null
      and output_spec is not null
      and vocabulary_snapshot_id is not null
      and content_hash is not null
    )
  );

-- label, enabled, and is_default are mutable. Everything else is in the
-- content hash and can never change — including enrichment_rank and
-- enrich_all_songs, because song_enrichment_attempts.recipe_rank records rank
-- at attempt time and an in-place edit would desync it. Same posture as the
-- attempts log's immutability trigger.
create function public.enforce_enrichment_recipe_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    to_jsonb(new) - array['label', 'enabled', 'is_default']
    <>
    to_jsonb(old) - array['label', 'enabled', 'is_default']
  ) then
    raise exception 'enrichment recipe identity is immutable';
  end if;

  return new;
end;
$$;

create trigger enrichment_recipes_immutable
before update on public.enrichment_recipes
for each row execute function
  public.enforce_enrichment_recipe_immutability();

revoke execute on function
  public.enforce_enrichment_recipe_immutability()
  from public, anon, authenticated;

-- One-transaction activation for the sync script. The partial unique index
-- enrichment_recipes_single_default_idx makes clear-then-set a mandatory
-- two-step, so the script cannot express a default swap safely as row updates.
create function public.sync_enrichment_recipe_activation(
  p_recipe_ids uuid[],
  p_default_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_recipe_ids is null then
    raise exception 'recipe id list is required';
  end if;

  if p_default_id is null or not (p_default_id = any(p_recipe_ids)) then
    raise exception 'default recipe must be among the enabled ids';
  end if;

  if exists (
    select 1
    from unnest(p_recipe_ids) wanted(id)
    where not exists (
      select 1 from public.enrichment_recipes er where er.id = wanted.id
    )
  ) then
    raise exception 'unknown recipe id in activation set';
  end if;

  update public.enrichment_recipes
  set is_default = false
  where is_default;

  update public.enrichment_recipes
  set enabled = false
  where enabled and not (id = any(p_recipe_ids));

  update public.enrichment_recipes
  set enabled = true
  where id = any(p_recipe_ids) and not enabled;

  update public.enrichment_recipes
  set is_default = true
  where id = p_default_id;
end;
$$;

revoke execute on function
  public.sync_enrichment_recipe_activation(uuid[], uuid)
  from public, anon, authenticated;

grant execute on function
  public.sync_enrichment_recipe_activation(uuid[], uuid)
  to service_role;

-- The claim returns the snapshot itself instead of version labels: the prompt,
-- the identity fields, the output spec, and the frozen vocabulary. The engine
-- reads everything from the claim and queries nothing else per batch — which
-- is what freezes the vocabulary per recipe. The inner join on
-- vocabulary_snapshots is safe: only enabled recipes are ever selected, the
-- CHECK above guarantees enabled rows carry a snapshot, and the immutability
-- trigger keeps it there for the idempotent-retry return path even if the
-- recipe is disabled mid-lease.
drop function public.claim_song_enrichment_jobs(uuid, integer, integer, uuid);

create function public.claim_song_enrichment_jobs(
  p_user_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_lease_token uuid
)
returns table (
  job_id uuid,
  lease_token uuid,
  song_id uuid,
  recipe_id uuid,
  expected_revision bigint,
  spotify_track_id text,
  title text,
  artists text[],
  album text,
  release_date date,
  provider text,
  model_id text,
  recipe_rank smallint,
  reasoning_effort text,
  system_prompt text,
  identity_fields text[],
  output_spec jsonb,
  genre_names text[],
  mood_names text[]
)
language plpgsql
set search_path = ''
as $$
declare
  chosen_recipe_id uuid;
  recipe_batch_size smallint;
  claimed_ids uuid[];
  lease_seconds integer := least(900, greatest(60, p_lease_seconds));
begin
  if p_limit < 1 then
    raise exception 'claim limit must be at least 1';
  end if;

  if p_lease_token is null then
    raise exception 'lease token is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_lease_token::text, 0)
  );

  select array_agg(j.id)
  into claimed_ids
  from public.song_enrichment_jobs j
  join public.user_songs us
    on us.song_id = j.song_id and us.user_id = p_user_id
  where j.status = 'leased'
    and j.lease_token = p_lease_token
    and j.lease_expires_at > now();

  if claimed_ids is not null and cardinality(claimed_ids) > 0 then
    return query
    select
      j.id,
      j.lease_token,
      s.id,
      er.id,
      j.expected_revision,
      s.spotify_track_id,
      s.title,
      s.artists,
      s.album,
      s.release_date,
      m.provider,
      m.model_id,
      er.enrichment_rank,
      er.reasoning_effort,
      er.system_prompt,
      er.identity_fields,
      er.output_spec,
      vs.genre_names,
      vs.mood_names
    from public.song_enrichment_jobs j
    join public.songs s on s.id = j.song_id
    join public.enrichment_recipes er on er.id = j.recipe_id
    join public.vocabulary_snapshots vs on vs.id = er.vocabulary_snapshot_id
    join public.llm_models m on m.id = er.model_id
    where j.id = any(claimed_ids)
    order by j.priority desc, j.id;
    return;
  end if;

  update public.song_enrichment_jobs j
  set
    status = 'queued',
    lease_token = null,
    lease_expires_at = null,
    expected_revision = null,
    updated_at = now()
  where j.status = 'leased'
    and j.lease_expires_at <= now()
    and exists (
      select 1
      from public.user_songs us
      where us.user_id = p_user_id and us.song_id = j.song_id
    );

  select j.recipe_id, er.batch_size
  into chosen_recipe_id, recipe_batch_size
  from public.song_enrichment_jobs j
  join public.user_songs us
    on us.song_id = j.song_id and us.user_id = p_user_id
  join public.enrichment_recipes er
    on er.id = j.recipe_id and er.enabled
  where j.status = 'queued'
    and j.next_attempt_at <= now()
  order by
    j.priority desc,
    (
      select count(*)
      from public.user_songs reach
      where reach.song_id = j.song_id
    ) desc,
    us.liked_at desc nulls last,
    j.updated_at desc,
    j.id
  for update of j skip locked
  limit 1;

  if chosen_recipe_id is null then
    return;
  end if;

  select array_agg(locked.id)
  into claimed_ids
  from (
    select j.id
    from public.song_enrichment_jobs j
    join public.user_songs us
      on us.song_id = j.song_id and us.user_id = p_user_id
    where j.recipe_id = chosen_recipe_id
      and j.status = 'queued'
      and j.next_attempt_at <= now()
    order by
      j.priority desc,
      (
        select count(*)
        from public.user_songs reach
        where reach.song_id = j.song_id
      ) desc,
      us.liked_at desc nulls last,
      j.updated_at desc,
      j.id
    for update of j skip locked
    limit least(p_limit, recipe_batch_size)
  ) locked;

  if claimed_ids is null or cardinality(claimed_ids) = 0 then
    return;
  end if;

  update public.song_enrichment_jobs j
  set
    status = 'leased',
    lease_token = p_lease_token,
    lease_expires_at = now() + make_interval(secs => lease_seconds),
    expected_revision = s.enrichment_revision,
    updated_at = now()
  from public.songs s
  where j.id = any(claimed_ids)
    and s.id = j.song_id;

  return query
  select
    j.id,
    j.lease_token,
    s.id,
    er.id,
    j.expected_revision,
    s.spotify_track_id,
    s.title,
    s.artists,
    s.album,
    s.release_date,
    m.provider,
    m.model_id,
    er.enrichment_rank,
    er.reasoning_effort,
    er.system_prompt,
    er.identity_fields,
    er.output_spec,
    vs.genre_names,
    vs.mood_names
  from public.song_enrichment_jobs j
  join public.songs s on s.id = j.song_id
  join public.enrichment_recipes er on er.id = j.recipe_id
  join public.vocabulary_snapshots vs on vs.id = er.vocabulary_snapshot_id
  join public.llm_models m on m.id = er.model_id
  where j.id = any(claimed_ids)
  order by j.priority desc, j.id;
end;
$$;

revoke execute on function
  public.claim_song_enrichment_jobs(uuid, integer, integer, uuid)
  from public, anon, authenticated;

grant execute on function
  public.claim_song_enrichment_jobs(uuid, integer, integer, uuid)
  to service_role;

-- The recipe report names the content hash where the three versions were. The
-- rest is unchanged from 20260815231025 (see that migration's header for the
-- SECURITY DEFINER rationale and the escalation-count guard).
drop function public.library_enrichment_recipes();

create function public.library_enrichment_recipes()
returns table (
  recipe_id uuid,
  label text,
  provider text,
  model_id text,
  reasoning_effort text,
  batch_size smallint,
  enrichment_rank smallint,
  content_hash text,
  enrich_all_songs boolean,
  is_current boolean,
  escalating_songs bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with current_recipe as (
    select er.id, er.enrichment_rank
    from public.enrichment_recipes er
    where er.enabled and er.is_default
    limit 1
  ),
  stronger as (
    select er.id
    from public.enrichment_recipes er
    where er.enabled
      and er.enrichment_rank > coalesce(
        (select cr.enrichment_rank from current_recipe cr), 0
      )
  ),
  escalating as (
    select chosen.recipe_id, count(*)::bigint as song_count
    from public.user_songs us
    join public.songs s on s.id = us.song_id
    cross join lateral (
      select public.next_enrichment_recipe(
        s.id,
        s.enrichment_status,
        s.ai_confidence,
        s.enrichment_rank,
        s.highest_attempted_recipe_rank
      ) as recipe_id
    ) chosen
    where us.user_id = (select auth.uid())
      and exists (select 1 from stronger)
      and chosen.recipe_id in (select st.id from stronger st)
    group by chosen.recipe_id
  )
  select
    er.id,
    er.label,
    m.provider,
    m.model_id,
    er.reasoning_effort,
    er.batch_size,
    er.enrichment_rank,
    er.content_hash,
    er.enrich_all_songs,
    er.id = (select cr.id from current_recipe cr),
    coalesce(escalating.song_count, 0)
  from public.enrichment_recipes er
  join public.llm_models m on m.id = er.model_id
  left join escalating on escalating.recipe_id = er.id
  where er.id = (select cr.id from current_recipe cr)
     or escalating.recipe_id is not null
  order by er.enrichment_rank, er.recipe_key;
$$;

revoke execute on function public.library_enrichment_recipes()
  from public, anon;

grant execute on function public.library_enrichment_recipes()
  to authenticated;
