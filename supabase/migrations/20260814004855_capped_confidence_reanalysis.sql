-- Capped re-analysis: three answers per recipe rank instead of one attempt,
-- Medium made eligible, High left alone, and a song locked once its budget at
-- the best available rank is spent.
--
-- Before this, the selector gate was `enrichment_rank > highest_attempted_rank`,
-- so a song could be analyzed once per rank. With only two enabled recipes and
-- every weak song already at the top rank, nothing could be improved at all.
--
-- Nothing here adds a column or a table. The budget is derived from the
-- append-only attempts log, which is the one place in this schema where drift
-- is impossible by construction, and the lock falls out of the same count: a
-- higher rank is simply a different count, so enabling a stronger recipe
-- re-opens every song without a reset step.

-- Exactly the predicate the counter uses, so the count stays index-only.
create index song_enrichment_attempts_answered_rank_idx
  on public.song_enrichment_attempts (song_id, recipe_rank)
  where outcome in ('recognized', 'unknown');

-- Ordinal over the five bands, mirroring CONFIDENCE_BAND_ORDER in
-- lib/enrichment/confidence.ts. Returns null for an unrecognized band so every
-- comparison against it is null — a promotion guard that fails closed.
create or replace function public.confidence_band_rank(p_band text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_band
    when 'pending' then 0
    when 'none' then 1
    when 'low' then 2
    when 'medium' then 3
    when 'high' then 4
  end
$$;

revoke execute on function public.confidence_band_rank(text)
  from public, anon, authenticated;

grant execute on function public.confidence_band_rank(text)
  to service_role;

-- How many more times this song may be analyzed at one recipe rank.
--
-- Keyed on rank, not recipe: `enrichment_rank` has no unique index, ties are
-- legal, and the unlock rule is rank-based — two tied recipes must not hand out
-- six answers at a rank capped at three.
--
-- Only `recognized` and `unknown` consume the budget. `omitted` and `failed`
-- have their own bounded lane in song_enrichment_jobs.attempt_count; sharing
-- one counter would let a song omitted twice get a single real analysis and
-- then lock forever. The decision is deliberately not considered: a rejected
-- attempt was still billed and still produced an answer.
create or replace function public.enrichment_attempts_remaining_at_rank(
  p_song_id uuid,
  p_recipe_rank smallint
)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    0,
    3 - (
      select count(*)
      from public.song_enrichment_attempts sea
      where sea.song_id = p_song_id
        and sea.recipe_rank = p_recipe_rank
        and sea.outcome in ('recognized', 'unknown')
    )
  )::integer
$$;

revoke execute on function
  public.enrichment_attempts_remaining_at_rank(uuid, smallint)
  from public, anon, authenticated;

grant execute on function
  public.enrichment_attempts_remaining_at_rank(uuid, smallint)
  to service_role;

-- The single eligibility rule, previously hand-written in four places: the
-- recipe that should run next for this song, or null when it is High, locked,
-- or out of recipes.
--
-- Ranks below the highest already attempted are excluded because promotion
-- rejects them as `superseded` — running one would bill for a guaranteed no-op.
--
-- The failed-job guard closes an otherwise infinite loop: a job left `failed`
-- with its omission allowance spent has produced zero *answers*, so the
-- confidence budget alone would re-open it every run, only to have it omitted
-- and fail again.
--
-- Escalation must sort before a same-rank retry. The old ordering led with
-- `is_default`, and since the default recipe is the middle rank, enabling a
-- stronger one would have made every song burn its same-rank budget instead of
-- moving up.
create or replace function public.next_enrichment_recipe(
  p_song_id uuid,
  p_enrichment_status text,
  p_ai_confidence numeric,
  p_highest_attempted_rank smallint
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select er.id
  from public.enrichment_recipes er
  where er.enabled
    and er.enrichment_rank >= p_highest_attempted_rank
    and public.enrichment_attempts_remaining_at_rank(
          p_song_id, er.enrichment_rank
        ) > 0
    and case public.confidence_band(p_enrichment_status, p_ai_confidence)
          -- A never-analyzed song goes to the default recipe, never to a
          -- cheaper one that merely outranks its starting rank of zero.
          when 'pending' then er.is_default
          when 'high' then false
          else true
        end
    and not exists (
      select 1
      from public.song_enrichment_jobs j
      where j.song_id = p_song_id
        and j.recipe_id = er.id
        and (j.status = 'failed' or j.attempt_count >= 3)
    )
  order by
    case when er.enrichment_rank > p_highest_attempted_rank then 0 else 1 end,
    er.enrichment_rank,
    er.recipe_key
  limit 1
$$;

revoke execute on function
  public.next_enrichment_recipe(uuid, text, numeric, smallint)
  from public, anon, authenticated;

grant execute on function
  public.next_enrichment_recipe(uuid, text, numeric, smallint)
  to service_role;

-- Bulk selection now runs through the shared rule and re-opens a completed job
-- for a same-rank retry. song_enrichment_attempts is unique on
-- (job_id, lease_token), so many attempts per job row are already supported —
-- a retry needs no new job row and no unique-key change.
create or replace function public.enqueue_library_enrichment_jobs(p_user_id uuid)
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
      case public.confidence_band(s.enrichment_status, s.ai_confidence)
        when 'pending' then 500
        when 'none' then 200
        else 100
      end as priority
    from public.user_songs us
    join public.songs s on s.id = us.song_id
    cross join lateral (
      select public.next_enrichment_recipe(
        s.id,
        s.enrichment_status,
        s.ai_confidence,
        s.highest_attempted_recipe_rank
      ) as recipe_id
    ) chosen
    where us.user_id = p_user_id
      and chosen.recipe_id is not null
      and not exists (
        select 1
        from public.song_enrichment_jobs active_job
        where active_job.song_id = s.id
          and active_job.status in ('queued', 'leased')
      )
  ),
  -- attempt_count is untouched on purpose: it is the omission/failure
  -- allowance read by retry_failed_enrichment_jobs. Bumping it would make the
  -- next genuine transient failure terminal; clearing it would hand out a
  -- fresh omission budget on every retry. result_attempt_id also stays — it is
  -- a truthful audit link, and is only ever joined under status = 'failed'.
  upserted as (
    insert into public.song_enrichment_jobs as j (
      song_id,
      recipe_id,
      priority
    )
    select song_id, recipe_id, priority
    from candidates
    on conflict (song_id, recipe_id) do update
    set
      status = 'queued',
      priority = greatest(j.priority, excluded.priority),
      request_count = j.request_count + 1,
      next_attempt_at = now(),
      lease_token = null,
      lease_expires_at = null,
      expected_revision = null,
      updated_at = now()
    where j.status = 'completed'
    returning j.id
  )
  select count(*)::integer into inserted_count from upserted;

  return inserted_count;
end;
$$;

-- Promotion keeps its three carve-outs and otherwise becomes one ordinal
-- comparison, so a band added later is handled without touching this chain.
-- Requirement: a Medium song accepts only a High result — that now holds by
-- construction rather than by enumeration.
create or replace function public.promote_song_enrichment_attempt(
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
    current_band := public.confidence_band(
      current_song.enrichment_status, current_song.ai_confidence
    );

    -- The candidate carries an outcome rather than a status; 'unknown' is what
    -- the songs table records as enrichment_status when nothing was recognized.
    candidate_band := public.confidence_band(
      case when candidate.outcome = 'unknown' then 'unknown' else 'enriched' end,
      candidate.confidence
    );

    -- This is the third and last High gate — the selector and the recheck RPC
    -- both refuse earlier — and the only one evaluated under a row lock, so it
    -- is the one that holds when a song turns High mid-lease.
    if current_band = 'high' then
      final_reason := 'ineligible';
    -- Carve-out: a pending song has nothing to lose, so any answer is better
    -- than no answer.
    elsif current_band = 'pending' then
      should_promote := true;
      final_reason := case
        when candidate.outcome = 'unknown' then 'initial_unknown'
        else 'initial_recognized'
      end;
    -- Carve-out: a None song holds zero tags, so recognition is an improvement
    -- even though None and a recognized-but-weak result can share a band.
    elsif current_band = 'none' and candidate.outcome = 'recognized' then
      should_promote := true;
      final_reason := 'recognized_after_unknown';
    elsif public.confidence_band_rank(candidate_band)
          > public.confidence_band_rank(current_band) then
      should_promote := true;
      final_reason := 'improved_band';
    elsif public.confidence_band_rank(candidate_band)
          < public.confidence_band_rank(current_band) then
      final_reason := 'would_downgrade';
    else
      -- Same band, including a higher confidence inside it. Promoting on that
      -- would be a max-of-N re-roll that walks every band's lower boundary
      -- upward without the analysis actually being better.
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

-- An explicit request goes through the same rule and the same job as automatic
-- analysis; only its priority differs, which puts it at the head of the next
-- claimed batch rather than on a separate single-song path.
--
-- The cooldown now answers 'throttled' instead of overloading 'already_checked',
-- which previously came back from three unrelated branches and made a
-- double-click indistinguishable from a genuine no-improvement result. It is
-- also checked before the recipe lookup, so a throttled click on a locked row
-- still reads as throttled, and it never consumes an attempt.
create or replace function public.request_song_enrichment_recheck(
  p_user_id uuid,
  p_song_id uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  current_song public.songs%rowtype;
  current_band text;
  next_recipe_id uuid;
  active_status text;
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

  current_band := public.confidence_band(
    current_song.enrichment_status, current_song.ai_confidence
  );

  if current_band = 'high' then
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

  select erl.last_requested_at into last_requested_at
  from public.enrichment_recheck_limits erl
  where erl.user_id = p_user_id and erl.song_id = p_song_id
  for update;

  if last_requested_at is not null
     and last_requested_at > now() - interval '10 seconds' then
    return 'throttled';
  end if;

  next_recipe_id := public.next_enrichment_recipe(
    p_song_id,
    current_song.enrichment_status,
    current_song.ai_confidence,
    current_song.highest_attempted_recipe_rank
  );

  if next_recipe_id is null then
    return 'no_better_recipe';
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

  -- next_enrichment_recipe already excluded recipes carrying a failed job, and
  -- queued/leased work returned above, so any existing job here is completed
  -- and re-opens cleanly.
  insert into public.song_enrichment_jobs as j (
    song_id,
    recipe_id,
    priority
  )
  values (
    p_song_id,
    next_recipe_id,
    case current_band
      when 'pending' then 600
      when 'none' then 400
      else 300
    end
  )
  on conflict (song_id, recipe_id) do update
  set
    status = 'queued',
    priority = greatest(j.priority, excluded.priority),
    request_count = j.request_count + 1,
    next_attempt_at = now(),
    lease_token = null,
    lease_expires_at = null,
    expected_revision = null,
    updated_at = now()
  where j.status = 'completed';

  return 'queued';
end;
$$;

-- The panel's totals move onto the same two functions the selector uses, so
-- the counts cannot drift from what enqueue will actually create.
-- `ineligible_weak` keeps its name but now means "below High and locked",
-- which includes Medium.
create or replace function public.get_library_enrichment_counts(p_user_id uuid)
returns table (
  total bigint,
  pending bigint,
  "none" bigint,
  low bigint,
  medium bigint,
  high bigint,
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
      where public.confidence_band(s.enrichment_status, s.ai_confidence)
        = 'pending'
    )::bigint as pending,
    count(*) filter (
      where public.confidence_band(s.enrichment_status, s.ai_confidence)
        = 'none'
    )::bigint as "none",
    count(*) filter (
      where public.confidence_band(s.enrichment_status, s.ai_confidence)
        = 'low'
    )::bigint as low,
    count(*) filter (
      where public.confidence_band(s.enrichment_status, s.ai_confidence)
        = 'medium'
    )::bigint as medium,
    count(*) filter (
      where public.confidence_band(s.enrichment_status, s.ai_confidence)
        = 'high'
    )::bigint as high,
    count(*) filter (
      where exists (
        select 1
        from public.song_enrichment_jobs j
        where j.song_id = s.id and j.status in ('queued', 'leased')
      )
    )::bigint as queued,
    count(*) filter (
      where public.confidence_band(s.enrichment_status, s.ai_confidence)
        in ('none', 'low', 'medium')
      and not exists (
        select 1
        from public.song_enrichment_jobs j
        where j.song_id = s.id and j.status in ('queued', 'leased')
      )
      and public.next_enrichment_recipe(
        s.id,
        s.enrichment_status,
        s.ai_confidence,
        s.highest_attempted_recipe_rank
      ) is null
    )::bigint as ineligible_weak,
    count(*) filter (
      where exists (
        select 1
        from public.song_enrichment_jobs j
        where j.song_id = s.id and j.status in ('queued', 'leased')
      )
      or public.next_enrichment_recipe(
        s.id,
        s.enrichment_status,
        s.ai_confidence,
        s.highest_attempted_recipe_rank
      ) is not null
    )::bigint as eligible
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  where us.user_id = p_user_id;
$$;

-- Adding a column changes the signature, so the old function is dropped rather
-- than left behind as an overload PostgREST would still expose.
drop function public.library_recheck_states();

-- Consumer-safe per-song state. SECURITY DEFINER is narrowly scoped to the
-- caller's own user_songs and returns no recipe, rank, provider, or demand
-- data from the service-only queue — attempts_remaining is a small count, not
-- a recipe identity.
--
-- The row filter widening to Medium is what turns the per-row control on for
-- Medium and Pending rows: library-table.tsx renders it iff a state exists.
create function public.library_recheck_states()
returns table (song_id uuid, state text, attempts_remaining smallint)
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
      when next_recipe.id is not null then 'available'
      when latest_attempt.decision = 'promoted' then 'improved'
      when latest_attempt.decision = 'rejected' then 'checked_not_improved'
      else 'no_better_recipe'
    end,
    -- Tries left at the level that would actually run; for a locked song that
    -- is the current rank, where the count is what locked it.
    public.enrichment_attempts_remaining_at_rank(
      s.id,
      coalesce(next_recipe.enrichment_rank, s.highest_attempted_recipe_rank)
    )::smallint
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
  left join lateral (
    select er.id, er.enrichment_rank
    from public.enrichment_recipes er
    where er.id = public.next_enrichment_recipe(
      s.id,
      s.enrichment_status,
      s.ai_confidence,
      s.highest_attempted_recipe_rank
    )
  ) next_recipe on true
  where us.user_id = (select auth.uid())
    and public.confidence_band(s.enrichment_status, s.ai_confidence)
      in ('pending', 'none', 'low', 'medium');
$$;

revoke execute on function public.library_recheck_states()
  from public, anon;

grant execute on function public.library_recheck_states()
  to authenticated;
