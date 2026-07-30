-- Restore the five user-facing confidence bands. The previous outcome summary
-- merged Medium/High and renamed every band; the product now exposes the
-- model-reported confidence bands directly as Pending/None/Low/Medium/High.

drop function public.library_enrichment_counts();
drop function public.get_library_enrichment_counts(uuid);

create function public.get_library_enrichment_counts(p_user_id uuid)
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
      where s.enrichment_status = 'pending'
    )::bigint as pending,
    count(*) filter (
      where s.enrichment_status = 'unknown'
    )::bigint as "none",
    count(*) filter (
      where s.enrichment_status = 'enriched'
        and coalesce(s.ai_confidence, 0) <= 0.5
    )::bigint as low,
    count(*) filter (
      where s.enrichment_status = 'enriched'
        and s.ai_confidence > 0.5
        and s.ai_confidence <= 0.75
    )::bigint as medium,
    count(*) filter (
      where s.enrichment_status = 'enriched'
        and s.ai_confidence > 0.75
    )::bigint as high,
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

revoke execute on function public.get_library_enrichment_counts(uuid)
  from public, anon, authenticated;

grant execute on function public.get_library_enrichment_counts(uuid)
  to service_role;

create function public.library_enrichment_counts()
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
