-- How hard the model was asked to think, and how many songs it weighed in one
-- go, become part of the recipe rather than deployment configuration.
--
-- Until now reasoning effort was a literal in lib/enrichment/engine.ts and the
-- batch size was the ENRICHMENT_BATCH_SIZE env var. Both shape the answer, and
-- neither was recorded against the attempts they shaped: two runs of the same
-- recipe could differ in what they actually asked for and nothing in
-- song_enrichment_attempts would say so. On the recipe they join
-- prompt/vocabulary/identity as things a new generation changes by creating a
-- new row, never by editing an old one.
--
-- The backfill is the column default: 'low' and 20 are exactly what ran, so no
-- historical attempt is retroactively misdescribed.

alter table public.enrichment_recipes
  add column reasoning_effort text not null default 'low'
    constraint enrichment_recipes_reasoning_effort_check
    check (reasoning_effort in ('minimal', 'low', 'medium', 'high')),
  add column batch_size smallint not null default 20
    constraint enrichment_recipes_batch_size_check
    check (batch_size between 1 and 50);

-- The claim resolves the batch size, because it already picks the recipe
-- before it selects rows. The engine passes only what is left of its per-run
-- spend cap and takes whatever the recipe allows, so the size never has to be
-- known — or trusted — anywhere outside the database.
--
-- p_limit therefore loses its upper bound: it is now a run budget rather than
-- a batch size, and least(p_limit, batch_size) with batch_size capped at 50 is
-- what keeps one LLM call inside its limits.
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
  prompt_version text,
  vocabulary_version text,
  identity_version text,
  reasoning_effort text
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
      er.prompt_version,
      er.vocabulary_version,
      er.identity_version,
      er.reasoning_effort
    from public.song_enrichment_jobs j
    join public.songs s on s.id = j.song_id
    join public.enrichment_recipes er on er.id = j.recipe_id
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
    er.prompt_version,
    er.vocabulary_version,
    er.identity_version,
    er.reasoning_effort
  from public.song_enrichment_jobs j
  join public.songs s on s.id = j.song_id
  join public.enrichment_recipes er on er.id = j.recipe_id
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
