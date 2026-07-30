-- Provider failures are billable attempts, but a single transient failure
-- must not strand a never-analyzed song forever. Advance the shared job's
-- bounded failure counter, requeue with backoff while allowance remains, and
-- leave the third failed attempt terminal.
create function public.retry_failed_enrichment_jobs(p_user_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  advanced_count integer;
begin
  update public.song_enrichment_jobs j
  set
    status = case
      when j.attempt_count + 1 >= 3 then 'failed'
      else 'queued'
    end,
    attempt_count = least(3, j.attempt_count + 1),
    next_attempt_at = case
      when j.attempt_count + 1 >= 3 then j.next_attempt_at
      else now() + make_interval(
        secs => (2 ^ (j.attempt_count + 1))::integer
      )
    end,
    updated_at = now()
  from public.song_enrichment_attempts sea
  join public.enrichment_recipes er on er.id = sea.recipe_id
  where j.result_attempt_id = sea.id
    and j.status = 'failed'
    and j.attempt_count < 3
    and sea.outcome = 'failed'
    and sea.decision = 'rejected'
    and er.enabled
    and exists (
      select 1
      from public.user_songs us
      where us.user_id = p_user_id and us.song_id = j.song_id
    );

  get diagnostics advanced_count = row_count;
  return advanced_count;
end;
$$;

revoke execute on function public.retry_failed_enrichment_jobs(uuid)
  from public, anon, authenticated;

grant execute on function public.retry_failed_enrichment_jobs(uuid)
  to service_role;

-- Keep the authoritative counts aligned with what enqueue can actually
-- create/recover. A pending song with a terminal job for the current default
-- is eligible only while a failed-attempt allowance remains.
create or replace function public.get_library_enrichment_counts(p_user_id uuid)
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
          select 1
          from public.enrichment_recipes er
          where er.enabled
            and er.is_default
            and (
              not exists (
                select 1
                from public.song_enrichment_jobs default_job
                where default_job.song_id = s.id
                  and default_job.recipe_id = er.id
              )
              or exists (
                select 1
                from public.song_enrichment_jobs default_job
                join public.song_enrichment_attempts sea
                  on sea.id = default_job.result_attempt_id
                where default_job.song_id = s.id
                  and default_job.recipe_id = er.id
                  and default_job.status = 'failed'
                  and default_job.attempt_count < 3
                  and sea.outcome = 'failed'
              )
            )
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

-- Consumer-safe summary for the Library's initial render. SECURITY DEFINER
-- exposes aggregate state only; recipe, rank, queue-demand, and attempt
-- details remain service-role-only.
create function public.library_enrichment_counts()
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
security definer
set search_path = ''
as $$
  select *
  from public.get_library_enrichment_counts((select auth.uid()));
$$;

revoke execute on function public.library_enrichment_counts()
  from public, anon;

grant execute on function public.library_enrichment_counts()
  to authenticated;
