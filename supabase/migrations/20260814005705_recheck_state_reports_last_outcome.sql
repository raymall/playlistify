-- Let a row show both what the last analysis concluded and that another try is
-- available, which capped re-analysis made possible for the first time.
--
-- The previous ordering tested availability before the last decision, so
-- 'improved' and 'checked_not_improved' could only ever appear on a song with
-- nowhere left to go. With three tries per rank, a song that came back "no
-- change" usually does have somewhere left to go, and hiding that behind
-- 'available' would drop the one piece of information the user just paid for.
--
-- attempts_remaining now reports 0 whenever no recipe would run, not only when
-- the budget is spent. That makes "> 0" mean exactly "clicking will analyze
-- something", which is the rule the row control keys off — a song blocked by a
-- terminally failed job has budget left but no recipe, and must not offer a
-- button that cannot do anything.

create or replace function public.library_recheck_states()
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
      when latest_attempt.decision = 'promoted' then 'improved'
      when latest_attempt.decision = 'rejected' then 'checked_not_improved'
      when next_recipe.id is not null then 'available'
      else 'no_better_recipe'
    end,
    case
      when next_recipe.id is null then 0
      else public.enrichment_attempts_remaining_at_rank(
        s.id, next_recipe.enrichment_rank
      )
    end::smallint
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
