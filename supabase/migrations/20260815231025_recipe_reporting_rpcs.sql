-- The Library stops asking "can I re-analyze this row?" and starts asking
-- "what is analyzing my songs?".
--
-- The per-song control is gone, and with it the last reader of the single-song
-- claim and the request throttle. What replaces them is not another control:
-- it is the recipe itself, named on the panel and on every row, so the thing
-- being paid for is visible rather than inferred.
--
-- Both new functions are SECURITY DEFINER for the same reason
-- library_recheck_states was: enrichment_recipes and song_enrichment_attempts
-- have RLS enabled with zero policies, so the RLS client cannot read them at
-- all. Each is scoped to the caller's own user_songs and granted only to
-- `authenticated`; neither returns queue state, lease data, or another user's
-- reach.

drop function public.claim_song_enrichment_job(uuid, uuid, integer, uuid);
drop table public.enrichment_recheck_limits;

-- Which recipe produced the result currently on each of the caller's songs.
--
-- Sourced from songs.active_enrichment_attempt_id rather than from
-- songs.enrichment_rank: the rank says how strong the recipe was, the attempt
-- says which one it actually was. A song with no promoted attempt yet returns
-- no row at all, so "no recipe" and "some recipe" are never confused.
--
-- Plain SQL and inlinable on purpose: /library filters this with
-- `.in('song_id', ids)`, and inlining is what turns that into a primary-key
-- lookup for the 50 rows on the page instead of a scan of the whole library.
create function public.library_song_recipes()
returns table (
  song_id uuid,
  recipe_id uuid,
  label text,
  is_current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    er.id,
    er.label,
    er.enabled and er.is_default
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  join public.song_enrichment_attempts sea
    on sea.id = s.active_enrichment_attempt_id
  join public.enrichment_recipes er on er.id = sea.recipe_id
  where us.user_id = (select auth.uid());
$$;

revoke execute on function public.library_song_recipes()
  from public, anon;

grant execute on function public.library_song_recipes()
  to authenticated;

-- The recipe the next run would use, and anywhere it would escalate.
--
-- Always returns the current recipe — the enabled default, which is what a
-- never-analyzed song gets — with the full identity behind it: model, effort,
-- batch size, the three versions, its rank, and whether it revisits High.
--
-- It additionally returns one row per enabled recipe that outranks the current
-- one and would actually claim songs on the next run, with how many. Those
-- rows are what make an escalation visible before it is paid for.
--
-- `escalating_songs` is deliberately not reported for the current recipe: the
-- panel already has that number as `eligible` from
-- get_library_enrichment_counts, and computing it here would mean a second
-- full pass over the library on every render.
--
-- The `exists (select 1 from stronger)` guard is load-bearing rather than
-- decorative. With no stronger recipe enabled — the normal state — it is an
-- uncorrelated one-time filter, so the per-song next_enrichment_recipe call is
-- never evaluated and this function costs three index lookups instead of a
-- scan of the caller's library.
create function public.library_enrichment_recipes()
returns table (
  recipe_id uuid,
  label text,
  provider text,
  model_id text,
  reasoning_effort text,
  batch_size smallint,
  enrichment_rank smallint,
  prompt_version text,
  vocabulary_version text,
  identity_version text,
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
    er.prompt_version,
    er.vocabulary_version,
    er.identity_version,
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
