-- Guarded global re-enrichment: versioned recipes, immutable attempts,
-- globally deduplicated leased jobs, atomic candidate promotion, and private
-- AI-tag suppressions.

create table public.enrichment_recipes (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.llm_models (id) on delete restrict,
  recipe_key text unique not null
    check (char_length(btrim(recipe_key)) > 0),
  label text not null check (char_length(btrim(label)) > 0),
  prompt_version text not null
    check (char_length(btrim(prompt_version)) > 0),
  vocabulary_version text not null
    check (char_length(btrim(vocabulary_version)) > 0),
  identity_version text not null
    check (char_length(btrim(identity_version)) > 0),
  enrichment_rank smallint not null check (enrichment_rank >= 0),
  enabled boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint enrichment_recipes_default_enabled
    check (not is_default or enabled)
);

create unique index enrichment_recipes_single_default_idx
  on public.enrichment_recipes (is_default)
  where is_default;

create index enrichment_recipes_model_id_idx
  on public.enrichment_recipes (model_id);

create index enrichment_recipes_enabled_rank_idx
  on public.enrichment_recipes (enrichment_rank, recipe_key)
  where enabled;

-- This is the one rollout seed: it snapshots every model configuration that
-- exists when the additive schema lands. Recipe identity is immutable from
-- here on; prompt/vocabulary/identity changes create new rows in Studio.
insert into public.enrichment_recipes (
  model_id,
  recipe_key,
  label,
  prompt_version,
  vocabulary_version,
  identity_version,
  enrichment_rank,
  enabled,
  is_default
)
select
  m.id,
  'legacy:' || m.provider || ':' || m.model_id ||
    ':prompt-v1:vocabulary-v1:identity-v1',
  m.label || ' · legacy recipe',
  'prompt-v1',
  'vocabulary-v1',
  'identity-v1',
  m.enrichment_rank,
  m.enabled,
  m.is_default
from public.llm_models m;

create table public.song_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete restrict,
  recipe_id uuid not null
    references public.enrichment_recipes (id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'completed', 'failed')),
  priority integer not null default 0,
  request_count integer not null default 1 check (request_count >= 1),
  attempt_count smallint not null default 0
    check (attempt_count between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  expected_revision bigint,
  result_attempt_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (song_id, recipe_id),
  constraint song_enrichment_jobs_lease_shape check (
    (status = 'leased' and lease_token is not null
      and lease_expires_at is not null and expected_revision is not null)
    or
    (status <> 'leased' and lease_token is null and lease_expires_at is null)
  )
);

create table public.song_enrichment_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null
    references public.song_enrichment_jobs (id) on delete restrict,
  lease_token uuid not null,
  song_id uuid not null references public.songs (id) on delete restrict,
  recipe_id uuid not null
    references public.enrichment_recipes (id) on delete restrict,
  recipe_rank smallint not null check (recipe_rank >= 0),
  provider text not null check (char_length(btrim(provider)) > 0),
  model_id text not null check (char_length(btrim(model_id)) > 0),
  outcome text not null
    check (outcome in ('recognized', 'unknown', 'omitted', 'failed')),
  confidence numeric(3, 2) check (confidence between 0 and 1),
  ai_attributes jsonb,
  genre_names text[] not null default '{}',
  mood_names text[] not null default '{}',
  expected_revision bigint not null check (expected_revision >= 0),
  decision text not null default 'pending'
    check (decision in ('pending', 'promoted', 'rejected')),
  decision_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (job_id, lease_token),
  constraint song_enrichment_attempts_outcome_shape check (
    (
      outcome = 'recognized'
      and confidence is not null
      and confidence >= 0.4
      and ai_attributes is not null
      and cardinality(genre_names) + cardinality(mood_names) > 0
    )
    or
    (
      outcome = 'unknown'
      and confidence is not null
      and ai_attributes is null
      and cardinality(genre_names) = 0
      and cardinality(mood_names) = 0
    )
    or
    (
      outcome in ('omitted', 'failed')
      and confidence is null
      and ai_attributes is null
      and cardinality(genre_names) = 0
      and cardinality(mood_names) = 0
    )
  ),
  constraint song_enrichment_attempts_decision_shape check (
    (decision = 'pending' and decision_reason is null and decided_at is null)
    or
    (decision <> 'pending' and decision_reason is not null
      and decided_at is not null)
  )
);

alter table public.song_enrichment_jobs
  add constraint song_enrichment_jobs_result_attempt_id_fkey
  foreign key (result_attempt_id)
  references public.song_enrichment_attempts (id)
  on delete restrict;

alter table public.songs
  add column active_enrichment_attempt_id uuid
    references public.song_enrichment_attempts (id) on delete restrict,
  add column enrichment_revision bigint not null default 0
    check (enrichment_revision >= 0),
  add column highest_attempted_recipe_id uuid
    references public.enrichment_recipes (id) on delete restrict,
  add column highest_attempted_recipe_rank smallint not null default 0
    check (highest_attempted_recipe_rank >= 0);

update public.songs
set highest_attempted_recipe_rank = enrichment_rank;

update public.songs s
set highest_attempted_recipe_id = er.id
from public.enrichment_recipes er
join public.llm_models m on m.id = er.model_id
where s.enrichment_model = m.provider || ':' || m.model_id
  and er.enrichment_rank = s.enrichment_rank;

create table public.user_genre_suppressions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  genre_id uuid not null references public.genres (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id, genre_id)
);

create table public.user_mood_suppressions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  mood_id uuid not null references public.moods (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id, mood_id)
);

-- A private throttle ledger lets repeated clicks coalesce without allowing one
-- account to inflate global request demand indefinitely.
create table public.enrichment_recheck_limits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  request_count integer not null default 1 check (request_count >= 1),
  last_requested_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

create index song_enrichment_jobs_recipe_id_idx
  on public.song_enrichment_jobs (recipe_id);

create index song_enrichment_jobs_claim_idx
  on public.song_enrichment_jobs (
    status,
    next_attempt_at,
    priority desc,
    updated_at desc
  );

create index song_enrichment_jobs_song_status_idx
  on public.song_enrichment_jobs (song_id, status);

create index song_enrichment_attempts_song_id_idx
  on public.song_enrichment_attempts (song_id);

create index song_enrichment_attempts_recipe_id_idx
  on public.song_enrichment_attempts (recipe_id);

create index song_enrichment_attempts_job_id_idx
  on public.song_enrichment_attempts (job_id);

create index songs_highest_attempted_recipe_id_idx
  on public.songs (highest_attempted_recipe_id);

create index songs_active_enrichment_attempt_id_idx
  on public.songs (active_enrichment_attempt_id);

create index user_genre_suppressions_song_id_idx
  on public.user_genre_suppressions (song_id);

create index user_genre_suppressions_genre_id_idx
  on public.user_genre_suppressions (genre_id);

create index user_mood_suppressions_song_id_idx
  on public.user_mood_suppressions (song_id);

create index user_mood_suppressions_mood_id_idx
  on public.user_mood_suppressions (mood_id);

create index enrichment_recheck_limits_song_id_idx
  on public.enrichment_recheck_limits (song_id);

alter table public.enrichment_recipes enable row level security;
alter table public.song_enrichment_jobs enable row level security;
alter table public.song_enrichment_attempts enable row level security;
alter table public.user_genre_suppressions enable row level security;
alter table public.user_mood_suppressions enable row level security;
alter table public.enrichment_recheck_limits enable row level security;

-- Recipes, jobs, attempts, and the throttle ledger are owner-operational and
-- service-role-only: RLS is enabled with zero client policies.

create policy "user_genre_suppressions_all_own"
  on public.user_genre_suppressions for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_mood_suppressions_all_own"
  on public.user_mood_suppressions for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Attempts are immutable evidence. The only permitted update is the one-way
-- pending → promoted/rejected decision transition performed by promotion.
create function public.enforce_song_enrichment_attempt_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'song enrichment attempts are append-only';
  end if;

  if old.decision <> 'pending'
     or new.decision not in ('promoted', 'rejected')
     or new.decision_reason is null
     or new.decided_at is null
     or (
       to_jsonb(new) - array['decision', 'decision_reason', 'decided_at']
       <>
       to_jsonb(old) - array['decision', 'decision_reason', 'decided_at']
     ) then
    raise exception 'song enrichment attempt is immutable';
  end if;

  return new;
end;
$$;

create trigger song_enrichment_attempts_immutable
before update or delete on public.song_enrichment_attempts
for each row execute function
  public.enforce_song_enrichment_attempt_immutability();

revoke execute on function
  public.enforce_song_enrichment_attempt_immutability()
  from public, anon, authenticated;

-- Create the next system-selected job for every eligible song in one user's
-- library. Existing queued/leased work blocks escalation until its retry lane
-- completes, and the (song, recipe) unique key coalesces concurrent callers.
create function public.enqueue_library_enrichment_jobs(p_user_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  with candidates as (
    select
      s.id as song_id,
      chosen.recipe_id,
      case
        when s.enrichment_status = 'pending' then 500
        when s.enrichment_status = 'unknown' then 200
        else 100
      end as priority
    from public.user_songs us
    join public.songs s on s.id = us.song_id
    cross join lateral (
      select er.id as recipe_id
      from public.enrichment_recipes er
      where er.enabled
        and (
          (s.enrichment_status = 'pending' and er.is_default)
          or
          (
            (
              s.enrichment_status = 'unknown'
              or (
                s.enrichment_status = 'enriched'
                and coalesce(s.ai_confidence, 0) <= 0.5
              )
            )
            and er.enrichment_rank > s.highest_attempted_recipe_rank
          )
        )
      order by
        case when er.is_default then 0 else 1 end,
        er.enrichment_rank,
        er.recipe_key
      limit 1
    ) chosen
    where us.user_id = p_user_id
      and not exists (
        select 1
        from public.song_enrichment_jobs active_job
        where active_job.song_id = s.id
          and active_job.status in ('queued', 'leased')
      )
  ),
  inserted as (
    insert into public.song_enrichment_jobs (
      song_id,
      recipe_id,
      priority
    )
    select song_id, recipe_id, priority
    from candidates
    on conflict (song_id, recipe_id) do nothing
    returning id
  )
  select count(*)::integer into inserted_count from inserted;

  return inserted_count;
end;
$$;

revoke execute on function public.enqueue_library_enrichment_jobs(uuid)
  from public, anon, authenticated;

grant execute on function public.enqueue_library_enrichment_jobs(uuid)
  to service_role;

-- Claim one same-recipe batch with row locks and a crash-safe lease. Expired
-- leases in this caller's library re-enter the queue before selection.
create function public.claim_song_enrichment_jobs(
  p_user_id uuid,
  p_limit integer,
  p_lease_seconds integer default 600
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
  identity_version text
)
language plpgsql
set search_path = ''
as $$
declare
  chosen_recipe_id uuid;
  claimed_ids uuid[];
  worker_token uuid := gen_random_uuid();
  lease_seconds integer := least(900, greatest(60, p_lease_seconds));
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception 'claim limit must be between 1 and 50';
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

  select j.recipe_id
  into chosen_recipe_id
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
    limit p_limit
  ) locked;

  if claimed_ids is null or cardinality(claimed_ids) = 0 then
    return;
  end if;

  update public.song_enrichment_jobs j
  set
    status = 'leased',
    lease_token = worker_token,
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
    er.identity_version
  from public.song_enrichment_jobs j
  join public.songs s on s.id = j.song_id
  join public.enrichment_recipes er on er.id = j.recipe_id
  join public.llm_models m on m.id = er.model_id
  where j.id = any(claimed_ids)
  order by j.priority desc, j.id;
end;
$$;

revoke execute on function
  public.claim_song_enrichment_jobs(uuid, integer, integer)
  from public, anon, authenticated;

grant execute on function
  public.claim_song_enrichment_jobs(uuid, integer, integer)
  to service_role;

-- Persist one billable per-song outcome under the lease that produced it.
-- The unique (job, lease token) key makes a response retry idempotent.
create function public.record_song_enrichment_attempt(
  p_job_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_confidence numeric,
  p_ai_attributes jsonb,
  p_genre_names text[],
  p_mood_names text[]
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  current_job public.song_enrichment_jobs%rowtype;
  existing_attempt_id uuid;
  new_attempt_id uuid;
begin
  select * into current_job
  from public.song_enrichment_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'enrichment job not found';
  end if;

  select id into existing_attempt_id
  from public.song_enrichment_attempts
  where job_id = p_job_id and lease_token = p_lease_token;

  if existing_attempt_id is not null then
    return existing_attempt_id;
  end if;

  if current_job.status <> 'leased'
     or current_job.lease_token <> p_lease_token
     or current_job.lease_expires_at <= now() then
    raise exception 'stale enrichment lease';
  end if;

  insert into public.song_enrichment_attempts (
    job_id,
    lease_token,
    song_id,
    recipe_id,
    recipe_rank,
    provider,
    model_id,
    outcome,
    confidence,
    ai_attributes,
    genre_names,
    mood_names,
    expected_revision
  )
  select
    current_job.id,
    p_lease_token,
    current_job.song_id,
    er.id,
    er.enrichment_rank,
    m.provider,
    m.model_id,
    p_outcome,
    p_confidence,
    p_ai_attributes,
    coalesce(p_genre_names, '{}'),
    coalesce(p_mood_names, '{}'),
    current_job.expected_revision
  from public.enrichment_recipes er
  join public.llm_models m on m.id = er.model_id
  where er.id = current_job.recipe_id
  returning id into new_attempt_id;

  return new_attempt_id;
end;
$$;

revoke execute on function
  public.record_song_enrichment_attempt(
    uuid,
    uuid,
    text,
    numeric,
    jsonb,
    text[],
    text[]
  )
  from public, anon, authenticated;

grant execute on function
  public.record_song_enrichment_attempt(
    uuid,
    uuid,
    text,
    numeric,
    jsonb,
    text[],
    text[]
  )
  to service_role;

-- The only canonical enrichment write path. It locks the lease, attempt, and
-- song, re-evaluates the latest canonical band, then replaces attributes and
-- both AI tag sets as one transaction or changes nothing.
create function public.promote_song_enrichment_attempt(
  p_attempt_id uuid,
  p_job_id uuid,
  p_lease_token uuid
)
returns table (
  decision text,
  reason text,
  is_promoted boolean
)
language plpgsql
set search_path = ''
as $$
declare
  current_job public.song_enrichment_jobs%rowtype;
  candidate public.song_enrichment_attempts%rowtype;
  current_song public.songs%rowtype;
  current_band text;
  candidate_band text;
  resolved_genres integer;
  resolved_moods integer;
  next_attempt_count smallint;
  final_decision text;
  final_reason text;
  should_promote boolean := false;
begin
  select * into current_job
  from public.song_enrichment_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'enrichment job not found';
  end if;

  select * into candidate
  from public.song_enrichment_attempts
  where id = p_attempt_id
  for update;

  if not found or candidate.job_id <> current_job.id then
    raise exception 'enrichment attempt does not belong to job';
  end if;

  if candidate.decision <> 'pending' then
    return query
    select
      candidate.decision,
      candidate.decision_reason,
      candidate.decision = 'promoted';
    return;
  end if;

  if current_job.status <> 'leased'
     or current_job.lease_token <> p_lease_token
     or candidate.lease_token <> p_lease_token
     or current_job.lease_expires_at <= now() then
    raise exception 'stale enrichment lease';
  end if;

  select * into current_song
  from public.songs
  where id = candidate.song_id
  for update;

  if candidate.recipe_rank > current_song.highest_attempted_recipe_rank then
    update public.songs
    set
      highest_attempted_recipe_id = candidate.recipe_id,
      highest_attempted_recipe_rank = candidate.recipe_rank
    where id = current_song.id;
    current_song.highest_attempted_recipe_id := candidate.recipe_id;
    current_song.highest_attempted_recipe_rank := candidate.recipe_rank;
  end if;

  if candidate.outcome = 'omitted' then
    next_attempt_count := current_job.attempt_count + 1;
    update public.song_enrichment_attempts
    set
      decision = 'rejected',
      decision_reason = 'omitted',
      decided_at = now()
    where id = candidate.id;

    if next_attempt_count >= 3 then
      update public.song_enrichment_jobs
      set
        status = 'failed',
        attempt_count = 3,
        lease_token = null,
        lease_expires_at = null,
        expected_revision = null,
        result_attempt_id = candidate.id,
        updated_at = now()
      where id = current_job.id;
    else
      update public.song_enrichment_jobs
      set
        status = 'queued',
        attempt_count = next_attempt_count,
        next_attempt_at =
          now() + make_interval(secs => (2 ^ next_attempt_count)::integer),
        lease_token = null,
        lease_expires_at = null,
        expected_revision = null,
        result_attempt_id = candidate.id,
        updated_at = now()
      where id = current_job.id;
    end if;

    return query select 'rejected'::text, 'omitted'::text, false;
    return;
  end if;

  if candidate.outcome = 'failed' then
    update public.song_enrichment_attempts
    set
      decision = 'rejected',
      decision_reason = 'failed',
      decided_at = now()
    where id = candidate.id;

    update public.song_enrichment_jobs
    set
      status = 'failed',
      lease_token = null,
      lease_expires_at = null,
      expected_revision = null,
      result_attempt_id = candidate.id,
      updated_at = now()
    where id = current_job.id;

    return query select 'rejected'::text, 'failed'::text, false;
    return;
  end if;

  if candidate.recipe_rank < current_song.highest_attempted_recipe_rank then
    final_reason := 'superseded';
  else
    current_band := case
      when current_song.enrichment_status = 'pending' then 'pending'
      when current_song.enrichment_status <> 'enriched' then 'none'
      when coalesce(current_song.ai_confidence, 0) <= 0.5 then 'low'
      when current_song.ai_confidence <= 0.75 then 'medium'
      else 'high'
    end;

    candidate_band := case
      when candidate.outcome = 'unknown' then 'none'
      when candidate.confidence <= 0.5 then 'low'
      when candidate.confidence <= 0.75 then 'medium'
      else 'high'
    end;

    if current_band in ('medium', 'high') then
      final_reason := 'ineligible';
    elsif current_band = 'pending' then
      should_promote := true;
      final_reason := case
        when candidate.outcome = 'unknown' then 'initial_unknown'
        else 'initial_recognized'
      end;
    elsif current_band = 'none' and candidate.outcome = 'recognized' then
      should_promote := true;
      final_reason := 'recognized_after_unknown';
    elsif current_band = 'none' then
      final_reason := 'not_better';
    elsif current_band = 'low'
      and candidate.outcome = 'recognized'
      and candidate_band in ('medium', 'high') then
      should_promote := true;
      final_reason := 'improved_band';
    elsif current_band = 'low' and candidate.outcome = 'unknown' then
      final_reason := 'would_downgrade';
    else
      final_reason := 'not_better';
    end if;
  end if;

  if should_promote and candidate.outcome = 'recognized' then
    select count(*)::integer into resolved_genres
    from unnest(candidate.genre_names) names(name)
    join public.genres g on g.name = names.name and g.is_approved;

    select count(*)::integer into resolved_moods
    from unnest(candidate.mood_names) names(name)
    join public.moods m on m.name = names.name and m.is_approved;

    if resolved_genres + resolved_moods = 0
       or resolved_genres <> cardinality(candidate.genre_names)
       or resolved_moods <> cardinality(candidate.mood_names) then
      should_promote := false;
      final_reason := 'invalid_candidate';
    end if;
  end if;

  if should_promote then
    delete from public.song_genres where song_id = current_song.id;
    delete from public.song_moods where song_id = current_song.id;

    if candidate.outcome = 'recognized' then
      insert into public.song_genres (song_id, genre_id)
      select current_song.id, g.id
      from unnest(candidate.genre_names) names(name)
      join public.genres g on g.name = names.name and g.is_approved
      on conflict (song_id, genre_id) do nothing;

      insert into public.song_moods (song_id, mood_id)
      select current_song.id, m.id
      from unnest(candidate.mood_names) names(name)
      join public.moods m on m.name = names.name and m.is_approved
      on conflict (song_id, mood_id) do nothing;

      update public.songs
      set
        ai_confidence = candidate.confidence,
        ai_attributes = candidate.ai_attributes,
        enrichment_status = 'enriched',
        enrichment_model = candidate.provider || ':' || candidate.model_id,
        enrichment_rank = candidate.recipe_rank,
        enrichment_attempts = 0,
        enrichment_skipped_rank = 0,
        enriched_at = now(),
        active_enrichment_attempt_id = candidate.id,
        enrichment_revision = enrichment_revision + 1
      where id = current_song.id;
    else
      update public.songs
      set
        ai_confidence = candidate.confidence,
        ai_attributes = null,
        enrichment_status = 'unknown',
        enrichment_model = candidate.provider || ':' || candidate.model_id,
        enrichment_rank = candidate.recipe_rank,
        enrichment_attempts = 0,
        enrichment_skipped_rank = 0,
        enriched_at = now(),
        active_enrichment_attempt_id = candidate.id,
        enrichment_revision = enrichment_revision + 1
      where id = current_song.id;
    end if;

    final_decision := 'promoted';
  else
    final_decision := 'rejected';
  end if;

  update public.song_enrichment_attempts
  set
    decision = final_decision,
    decision_reason = final_reason,
    decided_at = now()
  where id = candidate.id;

  update public.song_enrichment_jobs
  set
    status = 'completed',
    lease_token = null,
    lease_expires_at = null,
    expected_revision = null,
    result_attempt_id = candidate.id,
    updated_at = now()
  where id = current_job.id;

  return query
  select final_decision, final_reason, final_decision = 'promoted';
end;
$$;

revoke execute on function
  public.promote_song_enrichment_attempt(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function
  public.promote_song_enrichment_attempt(uuid, uuid, uuid)
  to service_role;

-- Explicit rechecks are ownership checked, rate limited per user/song, and
-- coalesced into the same global job used by automatic analysis.
create function public.request_song_enrichment_recheck(
  p_user_id uuid,
  p_song_id uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  current_song public.songs%rowtype;
  next_recipe_id uuid;
  active_status text;
  existing_status text;
  last_requested_at timestamptz;
begin
  if not exists (
    select 1
    from public.user_songs
    where user_id = p_user_id and song_id = p_song_id
  ) then
    raise exception 'song is not in caller library';
  end if;

  select * into current_song
  from public.songs
  where id = p_song_id
  for update;

  if not (
    current_song.enrichment_status = 'unknown'
    or (
      current_song.enrichment_status = 'enriched'
      and coalesce(current_song.ai_confidence, 0) <= 0.5
    )
  ) then
    raise exception 'song is not eligible for recheck';
  end if;

  select status into active_status
  from public.song_enrichment_jobs
  where song_id = p_song_id and status in ('queued', 'leased')
  order by updated_at desc
  limit 1;

  if active_status = 'leased' then
    return 'analyzing';
  elsif active_status = 'queued' then
    return 'already_queued';
  end if;

  select er.id into next_recipe_id
  from public.enrichment_recipes er
  where er.enabled
    and er.enrichment_rank > current_song.highest_attempted_recipe_rank
  order by er.enrichment_rank, er.recipe_key
  limit 1;

  if next_recipe_id is null then
    if exists (
      select 1
      from public.song_enrichment_jobs
      where song_id = p_song_id and status in ('completed', 'failed')
    ) then
      return 'already_checked';
    end if;
    return 'no_better_recipe';
  end if;

  select erl.last_requested_at into last_requested_at
  from public.enrichment_recheck_limits erl
  where erl.user_id = p_user_id and erl.song_id = p_song_id
  for update;

  if last_requested_at is not null
     and last_requested_at > now() - interval '10 seconds' then
    return 'already_checked';
  end if;

  insert into public.enrichment_recheck_limits (
    user_id,
    song_id,
    request_count,
    last_requested_at
  )
  values (p_user_id, p_song_id, 1, now())
  on conflict (user_id, song_id) do update
  set
    request_count = enrichment_recheck_limits.request_count + 1,
    last_requested_at = now();

  select status into existing_status
  from public.song_enrichment_jobs
  where song_id = p_song_id and recipe_id = next_recipe_id;

  if existing_status is not null then
    return case
      when existing_status = 'leased' then 'analyzing'
      when existing_status = 'queued' then 'already_queued'
      else 'already_checked'
    end;
  end if;

  insert into public.song_enrichment_jobs (
    song_id,
    recipe_id,
    priority,
    request_count
  )
  values (
    p_song_id,
    next_recipe_id,
    case when current_song.enrichment_status = 'unknown' then 400 else 300 end,
    1
  );

  return 'queued';
end;
$$;

revoke execute on function
  public.request_song_enrichment_recheck(uuid, uuid)
  from public, anon, authenticated;

grant execute on function
  public.request_song_enrichment_recheck(uuid, uuid)
  to service_role;

create function public.get_library_enrichment_counts(p_user_id uuid)
returns table (
  total bigint,
  ready bigint,
  tentative bigint,
  unrecognized bigint,
  waiting bigint,
  queued bigint,
  ineligible_weak bigint,
  eligible bigint
)
language sql
stable
set search_path = ''
as $$
  select
    count(*)::bigint as total,
    count(*) filter (
      where s.enrichment_status = 'enriched'
        and s.ai_confidence > 0.5
    )::bigint as ready,
    count(*) filter (
      where s.enrichment_status = 'enriched'
        and coalesce(s.ai_confidence, 0) <= 0.5
    )::bigint as tentative,
    count(*) filter (
      where s.enrichment_status = 'unknown'
    )::bigint as unrecognized,
    count(*) filter (
      where s.enrichment_status = 'pending'
    )::bigint as waiting,
    count(*) filter (
      where exists (
        select 1
        from public.song_enrichment_jobs j
        where j.song_id = s.id and j.status in ('queued', 'leased')
      )
    )::bigint as queued,
    count(*) filter (
      where (
        s.enrichment_status = 'unknown'
        or (
          s.enrichment_status = 'enriched'
          and coalesce(s.ai_confidence, 0) <= 0.5
        )
      )
      and not exists (
        select 1
        from public.song_enrichment_jobs j
        where j.song_id = s.id and j.status in ('queued', 'leased')
      )
      and not exists (
        select 1
        from public.enrichment_recipes er
        where er.enabled
          and er.enrichment_rank > s.highest_attempted_recipe_rank
      )
    )::bigint as ineligible_weak,
    count(*) filter (
      where exists (
        select 1
        from public.song_enrichment_jobs j
        where j.song_id = s.id and j.status in ('queued', 'leased')
      )
      or (
        s.enrichment_status = 'pending'
        and exists (
          select 1 from public.enrichment_recipes er
          where er.enabled and er.is_default
        )
      )
      or (
        (
          s.enrichment_status = 'unknown'
          or (
            s.enrichment_status = 'enriched'
            and coalesce(s.ai_confidence, 0) <= 0.5
          )
        )
        and exists (
          select 1
          from public.enrichment_recipes er
          where er.enabled
            and er.enrichment_rank > s.highest_attempted_recipe_rank
        )
      )
    )::bigint as eligible
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  where us.user_id = p_user_id;
$$;

revoke execute on function public.get_library_enrichment_counts(uuid)
  from public, anon, authenticated;

grant execute on function public.get_library_enrichment_counts(uuid)
  to service_role;

-- Effective library tags: (ready canonical AI - suppressions) + personal.
-- Tentative AI tags remain visible in the library but do not drive playlist
-- matching; personal tags make any song selectable.
create or replace function public.library_tag_names()
returns table (kind text, id uuid, name text)
language sql
stable
set search_path = ''
as $$
  select 'genre'::text, g.id, g.name
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  join public.song_genres sg on sg.song_id = us.song_id
  join public.genres g on g.id = sg.genre_id
  where s.enrichment_status = 'enriched'
    and s.ai_confidence > 0.5
    and not exists (
      select 1
      from public.user_genre_suppressions ugs
      where ugs.user_id = us.user_id
        and ugs.song_id = us.song_id
        and ugs.genre_id = sg.genre_id
    )
  union
  select 'genre'::text, g.id, g.name
  from public.user_genres ug
  join public.genres g on g.id = ug.genre_id
  union
  select 'mood'::text, m.id, m.name
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  join public.song_moods sm on sm.song_id = us.song_id
  join public.moods m on m.id = sm.mood_id
  where s.enrichment_status = 'enriched'
    and s.ai_confidence > 0.5
    and not exists (
      select 1
      from public.user_mood_suppressions ums
      where ums.user_id = us.user_id
        and ums.song_id = us.song_id
        and ums.mood_id = sm.mood_id
    )
  union
  select 'mood'::text, m.id, m.name
  from public.user_moods um
  join public.moods m on m.id = um.mood_id;
$$;

create or replace function public.library_selectable_songs()
returns table (song_id uuid, liked_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select us.song_id, us.liked_at
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  where (
      s.enrichment_status = 'enriched' and s.ai_confidence > 0.5
    )
     or exists (
       select 1 from public.user_genres ug
       where ug.song_id = us.song_id and ug.user_id = us.user_id
     )
     or exists (
       select 1 from public.user_moods um
       where um.song_id = us.song_id and um.user_id = us.user_id
     )
  order by us.liked_at desc nulls last, us.song_id;
$$;

create function public.library_effective_tagged_songs(
  p_kind text,
  p_tag_ids uuid[]
)
returns table (song_id uuid)
language sql
stable
set search_path = ''
as $$
  select distinct matches.song_id
  from (
    select us.song_id
    from public.user_songs us
    join public.songs s on s.id = us.song_id
    join public.song_genres sg on sg.song_id = us.song_id
    where p_kind = 'genre'
      and sg.genre_id = any(p_tag_ids)
      and s.enrichment_status = 'enriched'
      and s.ai_confidence > 0.5
      and not exists (
        select 1
        from public.user_genre_suppressions ugs
        where ugs.user_id = us.user_id
          and ugs.song_id = us.song_id
          and ugs.genre_id = sg.genre_id
      )
    union all
    select ug.song_id
    from public.user_genres ug
    where p_kind = 'genre' and ug.genre_id = any(p_tag_ids)
    union all
    select us.song_id
    from public.user_songs us
    join public.songs s on s.id = us.song_id
    join public.song_moods sm on sm.song_id = us.song_id
    where p_kind = 'mood'
      and sm.mood_id = any(p_tag_ids)
      and s.enrichment_status = 'enriched'
      and s.ai_confidence > 0.5
      and not exists (
        select 1
        from public.user_mood_suppressions ums
        where ums.user_id = us.user_id
          and ums.song_id = us.song_id
          and ums.mood_id = sm.mood_id
      )
    union all
    select um.song_id
    from public.user_moods um
    where p_kind = 'mood' and um.mood_id = any(p_tag_ids)
  ) matches
  where p_kind in ('genre', 'mood');
$$;

revoke execute on function
  public.library_effective_tagged_songs(text, uuid[])
  from public, anon;

grant execute on function
  public.library_effective_tagged_songs(text, uuid[])
  to authenticated;

-- Consumer-safe per-song state. SECURITY DEFINER is narrowly scoped to the
-- caller's own user_songs and returns no recipe, rank, provider, or demand
-- data from the service-only queue.
create function public.library_recheck_states()
returns table (song_id uuid, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    case
      when active_job.status = 'leased' then 'analyzing'
      when active_job.status = 'queued' then 'queued'
      when exists (
        select 1
        from public.enrichment_recipes er
        where er.enabled
          and er.enrichment_rank > s.highest_attempted_recipe_rank
      ) then 'available'
      when latest_attempt.decision = 'promoted' then 'improved'
      when latest_attempt.decision = 'rejected' then 'checked_not_improved'
      else 'no_better_recipe'
    end
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  left join lateral (
    select j.status
    from public.song_enrichment_jobs j
    where j.song_id = s.id and j.status in ('queued', 'leased')
    order by j.updated_at desc
    limit 1
  ) active_job on true
  left join lateral (
    select sea.decision
    from public.song_enrichment_attempts sea
    where sea.song_id = s.id and sea.decision <> 'pending'
    order by sea.decided_at desc
    limit 1
  ) latest_attempt on true
  where us.user_id = (select auth.uid())
    and (
      s.enrichment_status = 'unknown'
      or (
        s.enrichment_status = 'enriched'
        and coalesce(s.ai_confidence, 0) <= 0.5
      )
    );
$$;

revoke execute on function public.library_recheck_states()
  from public, anon;

grant execute on function public.library_recheck_states()
  to authenticated;
