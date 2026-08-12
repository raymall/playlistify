-- Confidence-band filtering for /library, alongside the existing free text and
-- genre/mood pills.
--
-- The band rule already existed twice — getConfidenceBand in
-- lib/enrichment/confidence.ts (the badge on each row) and the count filters in
-- get_library_enrichment_counts (the panel totals). A third hand-written copy in
-- the search predicate would be a drift waiting to happen, so the rule becomes
-- one IMMUTABLE function here and the search calls it.
--
-- Calling a function in the qual would normally cost sargability. An expression
-- index over the identical call buys it back, so `confidence_band(...) = any($n)`
-- is an index qual rather than a per-row filter. That is also why this needs no
-- generated column: an expression index takes SHARE (blocks writes, allows
-- reads) instead of rewriting the whole songs table under ACCESS EXCLUSIVE.

-- Mirrors getConfidenceBand exactly. Deliberately NOT strict: a null
-- ai_confidence is a real Low, not an absent band.
-- `enrichment_status` is CHECKed to ('pending', 'enriched', 'unknown'), which is
-- what makes `<> 'enriched'` here and `= 'unknown'` in the counts equivalent.
create or replace function public.confidence_band(
  p_status text,
  p_confidence numeric
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'pending' then 'pending'
    when p_status <> 'enriched' then 'none'
    when coalesce(p_confidence, 0) <= 0.5 then 'low'
    when p_confidence <= 0.75 then 'medium'
    else 'high'
  end
$$;

create index songs_confidence_band_idx
  on public.songs (public.confidence_band(enrichment_status, ai_confidence));

-- Adding a parameter changes the signature, so the old one is dropped rather
-- than left behind as an overload PostgREST would still expose.
drop function if exists public.library_search_page(
  text[], text[], text[], integer, integer, boolean
);

create or replace function public.library_search_page(
  p_terms text[] default '{}'::text[],
  p_genres text[] default '{}'::text[],
  p_moods text[] default '{}'::text[],
  p_bands text[] default '{}'::text[],
  p_limit integer default 50,
  p_offset integer default 0,
  p_with_count boolean default true
)
returns table (song_id uuid, liked_at timestamptz, total_count bigint)
language sql
stable
security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
  with tag_hits as materialized (
    select us.song_id, g.id as tag_id
    from public.genres g
    join public.song_genres sg on sg.genre_id = g.id
    join public.user_songs us on us.song_id = sg.song_id
    where g.name = any (p_genres)
      and us.user_id = (select auth.uid())
      and not exists (
        select 1
        from public.user_genre_suppressions x
        where x.user_id = us.user_id
          and x.song_id = us.song_id
          and x.genre_id = sg.genre_id
      )
    union
    select ug.song_id, g.id
    from public.genres g
    join public.user_genres ug on ug.genre_id = g.id
    where g.name = any (p_genres)
      and ug.user_id = (select auth.uid())
    union
    select us.song_id, m.id
    from public.moods m
    join public.song_moods sm on sm.mood_id = m.id
    join public.user_songs us on us.song_id = sm.song_id
    where m.name = any (p_moods)
      and us.user_id = (select auth.uid())
      and not exists (
        select 1
        from public.user_mood_suppressions x
        where x.user_id = us.user_id
          and x.song_id = us.song_id
          and x.mood_id = sm.mood_id
      )
    union
    select um.song_id, m.id
    from public.moods m
    join public.user_moods um on um.mood_id = m.id
    where m.name = any (p_moods)
      and um.user_id = (select auth.uid())
  ),
  tag_matched as materialized (
    select h.song_id
    from tag_hits h
    group by h.song_id
    having count(*) =
        (
          select count(distinct t.name)
          from unnest(coalesce(p_genres, '{}'::text[])) as t (name)
        )
      + (
          select count(distinct t.name)
          from unnest(coalesce(p_moods, '{}'::text[])) as t (name)
        )
  ),
  filtered as not materialized (
    select us.song_id, us.liked_at
    from public.user_songs us
    -- With no terms and no bands, nothing references `s` and the planner drops
    -- this join entirely; a band or text filter is what brings songs back in.
    left join public.songs s on s.id = us.song_id
    where us.user_id = (select auth.uid())
      and (
        cardinality(coalesce(p_terms, '{}'::text[])) = 0
        or (
          s.search_text like ('%' || public.like_escape(lower(p_terms[1])) || '%')
          and not exists (
            select 1
            from unnest(p_terms[2:]) as t (term)
            where s.search_text not like
              ('%' || public.like_escape(lower(t.term)) || '%')
          )
        )
      )
      and (
        cardinality(coalesce(p_genres, '{}'::text[]))
          + cardinality(coalesce(p_moods, '{}'::text[])) = 0
        or exists (select 1 from tag_matched tm where tm.song_id = us.song_id)
      )
      and (
        -- Bands OR against each other: a song carries exactly one, so ANDing
        -- two would always be empty. They still AND with text and with tags.
        cardinality(coalesce(p_bands, '{}'::text[])) = 0
        or public.confidence_band(s.enrichment_status, s.ai_confidence)
             = any (p_bands)
      )
  )
  select
    f.song_id,
    f.liked_at,
    case when p_with_count then (select count(*) from filtered) end
  from filtered f
  order by f.liked_at desc nulls last, f.song_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function
  public.library_search_page(
    text[], text[], text[], text[], integer, integer, boolean
  )
  from public, anon;

grant execute on function
  public.library_search_page(
    text[], text[], text[], text[], integer, integer, boolean
  )
  to authenticated;
