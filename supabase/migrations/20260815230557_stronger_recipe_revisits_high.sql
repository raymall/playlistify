-- A High song is finished — unless a strictly stronger recipe says otherwise.
--
-- Until now High was terminal at three separate gates. That is the right
-- default: re-rolling a High result is a max-of-N that walks the band's lower
-- boundary upward and pays for the privilege. But it also means a genuinely
-- better recipe can never revisit the 1738 songs that matter most, and there
-- was no way to say "this one is worth it".
--
-- enrich_all_songs is that opt-in, and it is per recipe rather than global so
-- enabling a stronger recipe stays a decision about that recipe. Default false:
-- every existing recipe keeps the old behaviour exactly.
--
-- Never a downgrade. A High song may only be replaced by another High result;
-- anything weaker is rejected `would_downgrade`, so the canonical band is
-- monotonic and the no-regression assertion in verify:re-enrichment keeps
-- holding.

alter table public.enrichment_recipes
  add column enrich_all_songs boolean not null default false;

-- next_enrichment_recipe gains the song's *active* rank as a parameter, and
-- the High gate compares against that rather than against the highest rank
-- ever attempted.
--
-- The distinction is what makes the three-attempt budget work here. Promotion
-- bumps highest_attempted_recipe_rank on the very first attempt at a new rank,
-- so a High gate written against it would open for exactly one try and then
-- close — while every other band gets three. enrichment_rank only moves when a
-- candidate is actually promoted, so it stays put across all three tries and
-- then, on a win, closes the rank for good.
--
-- It also makes this gate agree with the one in
-- promote_song_enrichment_attempt below, which compares the same two ranks. A
-- selector that offered work promotion would always refuse is the exact defect
-- the "one eligibility rule" design exists to prevent.
--
-- Two callers of the old signature are dropped rather than carried:
-- library_recheck_states and request_song_enrichment_recheck both served the
-- per-song re-analysis control, which no longer exists in the app.
drop function public.library_recheck_states();
drop function public.request_song_enrichment_recheck(uuid, uuid);
drop function public.next_enrichment_recipe(uuid, text, numeric, smallint);

create function public.next_enrichment_recipe(
  p_song_id uuid,
  p_enrichment_status text,
  p_ai_confidence numeric,
  p_enrichment_rank smallint,
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
          -- High is finished unless a recipe both opts in and genuinely
          -- outranks the one that produced the result being replaced.
          when 'high' then
            er.enrich_all_songs and er.enrichment_rank > p_enrichment_rank
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
  public.next_enrichment_recipe(uuid, text, numeric, smallint, smallint)
  from public, anon, authenticated;

grant execute on function
  public.next_enrichment_recipe(uuid, text, numeric, smallint, smallint)
  to service_role;

-- Both remaining callers pass the song's active rank alongside the row columns
-- they already had in hand.
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
        s.enrichment_rank,
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

-- `ineligible_weak` still means "below High and locked", so an opted-in High
-- song shows up in `eligible` without ever being counted as weak.
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
        s.enrichment_rank,
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
        s.enrichment_rank,
        s.highest_attempted_recipe_rank
      ) is not null
    )::bigint as eligible
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  where us.user_id = p_user_id;
$$;

-- The last of the three High gates, and the only one under a row lock — so it
-- is what holds when a song turns High mid-lease, and what decides whether an
-- opted-in candidate actually replaces the result.
--
-- The rank compared here is songs.enrichment_rank, deliberately read before
-- this function's own bump of highest_attempted_recipe_rank could confuse it.
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
  active_rank smallint;
  candidate_enriches_all boolean;
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

  active_rank := current_song.enrichment_rank;

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

    if current_band = 'high' then
      select er.enrich_all_songs into candidate_enriches_all
      from public.enrichment_recipes er
      where er.id = candidate.recipe_id;

      -- Fails closed: a recipe that has not opted in, or that does not
      -- outrank the result on the row, leaves High exactly as it was.
      if not coalesce(candidate_enriches_all, false)
         or candidate.recipe_rank <= active_rank then
        final_reason := 'ineligible';
      elsif candidate_band = 'high' then
        should_promote := true;
        final_reason := 'stronger_recipe';
      else
        -- Opted in and stronger, but the answer came back weaker. High is the
        -- top band, so anything else is a downgrade and is refused.
        final_reason := 'would_downgrade';
      end if;
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
