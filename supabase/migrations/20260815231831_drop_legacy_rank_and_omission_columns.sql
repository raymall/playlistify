-- Four columns the job/attempt schema replaced, still being written every run.
--
-- songs.enrichment_attempts / songs.enrichment_skipped_rank were the
-- pre-queue omission counter: how many times a model had left a song out of
-- its batch, and the rank it was given up at. song_enrichment_jobs.attempt_count
-- has been that allowance since guarded re-enrichment, and promotion now only
-- ever writes literal zeros to these two — a counter that resets and never
-- counts.
--
-- llm_models.enrichment_rank predates recipes. Ranking is a property of the
-- recipe, not the model, because prompt and vocabulary generations of the same
-- model can be ordered differently; enrichment_recipes.enrichment_rank has
-- been the only rank any code reads since.
--
-- song_enrichment_jobs.request_count was incremented on every enqueue and
-- every re-open and read by nothing, anywhere. Demand is recoverable from
-- song_enrichment_attempts, which records the answers that were actually
-- billed rather than the intent to ask.

-- The index spans a column being dropped, so it would go with it. Recreated on
-- the prefix that still means something.
drop index public.songs_enrichment_rank_idx;

alter table public.songs
  drop column enrichment_attempts,
  drop column enrichment_skipped_rank;

create index songs_enrichment_rank_idx
  on public.songs (enrichment_status, enrichment_rank);

alter table public.llm_models drop column enrichment_rank;

alter table public.song_enrichment_jobs drop column request_count;

-- Re-opening a completed job no longer bumps a counter nothing reads.
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

-- Promotion stops writing the two retired song columns. Everything else about
-- the chain is unchanged.
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
