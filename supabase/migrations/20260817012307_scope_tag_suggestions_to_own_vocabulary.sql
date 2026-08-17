-- Scope the tag typeahead's candidate pool to the caller's OWN vocabulary:
-- the approved list, plus rows this caller personally linked.
--
-- The results were already caller-scoped — the counting arms all filter on
-- auth.uid() and the query ends with `where c.total > 0`, so a tag you do not
-- have is dropped and another user's tag was never displayable. The gap was
-- upstream of that: the 50-row shortlist was drawn from the whole shared
-- vocabulary, and free-form personal tags removed the only bound on how fast
-- that grows. Strangers' tags could fill all 50 slots on a common substring,
-- get counted at 0, and be filtered out — leaving the caller with an empty
-- dropdown while a tag they actually own went unsuggested. Silent
-- under-suggestion, not leakage.
--
-- Fixed with a predicate rather than a union arm: no dedup for a tag that is
-- both approved and personally linked, and the exists() is an index-only seek
-- evaluated only for rows that already passed the name filter.

create or replace function public.library_tag_suggestions(
  p_query text default '',
  p_limit integer default 10,
  p_count_cap integer default 200
)
returns table (kind text, name text, song_count bigint, is_capped boolean)
language sql
stable
security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
  -- normalize_tag_name(coalesce(p_query, '')) is repeated rather than hoisted
  -- into a CTE on purpose: it is IMMUTABLE over a parameter, so under a custom
  -- plan the whole pattern folds to a constant and the trigram GIN is usable.
  -- A CTE would make it a SubPlan, and a SubPlan-bearing qual can use no index.
  with shortlist as materialized (
    select *
    from (
      select
        'genre'::text as kind,
        g.id as tag_id,
        g.name as tag_name,
        g.name like
          (
            public.like_escape(
              public.normalize_tag_name(coalesce(p_query, ''))
            ) || '%'
          ) as is_prefix
      from public.genres g
      where public.normalize_tag_name(coalesce(p_query, '')) <> ''
        and g.name like
          (
            '%' || public.like_escape(
              public.normalize_tag_name(coalesce(p_query, ''))
            ) || '%'
          )
        -- Own-vocabulary gate: the approved list, plus any row THIS caller
        -- personally linked. Another user's free-form tag is not a candidate,
        -- so it can never occupy one of the 50 shortlist slots. Seeks
        -- user_genres_genre_user_song_idx (genre_id, user_id, song_id).
        and (
          g.is_approved
          or exists (
            select 1
            from public.user_genres ug
            where ug.genre_id = g.id
              and ug.user_id = (select auth.uid())
          )
        )
      union all
      select
        'mood'::text,
        m.id,
        m.name,
        m.name like
          (
            public.like_escape(
              public.normalize_tag_name(coalesce(p_query, ''))
            ) || '%'
          )
      from public.moods m
      where public.normalize_tag_name(coalesce(p_query, '')) <> ''
        and m.name like
          (
            '%' || public.like_escape(
              public.normalize_tag_name(coalesce(p_query, ''))
            ) || '%'
          )
        and (
          m.is_approved
          or exists (
            select 1
            from public.user_moods um
            where um.mood_id = m.id
              and um.user_id = (select auth.uid())
          )
        )
    ) c
    -- Prefix-first, then shortest, then alphabetical: `reg` should offer
    -- `reggae` before `progressive reggae`. Bounded BEFORE any counting.
    order by c.is_prefix desc, length(c.tag_name), c.tag_name
    limit 50
  ),
  counted as (
    select s.kind, s.tag_name, s.is_prefix, hits.total
    from shortlist s
    cross join lateral (
      -- Four arms under the same DISPLAY rule as library_search_page. Each is
      -- capped at cap + 1 rows, so a globally huge tag costs the same as a tiny
      -- one; the union then dedupes songs carrying both an AI and a personal
      -- link. A truncated arm always yields cap + 1 distinct song ids, so a
      -- total at or below the cap is always exact.
      -- The `s.kind = ...` guards let the planner skip the other kind's arms
      -- outright; genre and mood ids are disjoint anyway, so each would degrade
      -- to an empty index seek rather than a wrong answer.
      select count(*) as total
      from (
        select capped.song_id
        from (
          select us.song_id
          from public.song_genres sg
          join public.user_songs us on us.song_id = sg.song_id
          where s.kind = 'genre'
            and sg.genre_id = s.tag_id
            and us.user_id = (select auth.uid())
            and not exists (
              select 1
              from public.user_genre_suppressions x
              where x.user_id = us.user_id
                and x.song_id = us.song_id
                and x.genre_id = sg.genre_id
            )
          limit least(greatest(coalesce(p_count_cap, 200), 1), 1000) + 1
        ) capped
        union
        select capped.song_id
        from (
          select ug.song_id
          from public.user_genres ug
          where s.kind = 'genre'
            and ug.genre_id = s.tag_id
            and ug.user_id = (select auth.uid())
          limit least(greatest(coalesce(p_count_cap, 200), 1), 1000) + 1
        ) capped
        union
        select capped.song_id
        from (
          select us.song_id
          from public.song_moods sm
          join public.user_songs us on us.song_id = sm.song_id
          where s.kind = 'mood'
            and sm.mood_id = s.tag_id
            and us.user_id = (select auth.uid())
            and not exists (
              select 1
              from public.user_mood_suppressions x
              where x.user_id = us.user_id
                and x.song_id = us.song_id
                and x.mood_id = sm.mood_id
            )
          limit least(greatest(coalesce(p_count_cap, 200), 1), 1000) + 1
        ) capped
        union
        select capped.song_id
        from (
          select um.song_id
          from public.user_moods um
          where s.kind = 'mood'
            and um.mood_id = s.tag_id
            and um.user_id = (select auth.uid())
          limit least(greatest(coalesce(p_count_cap, 200), 1), 1000) + 1
        ) capped
      ) matches
    ) hits
  )
  select
    c.kind,
    c.tag_name,
    least(c.total, least(greatest(coalesce(p_count_cap, 200), 1), 1000)),
    c.total > least(greatest(coalesce(p_count_cap, 200), 1), 1000)
  from counted c
  -- Never suggest a filter that would return nothing.
  where c.total > 0
  order by c.is_prefix desc, c.total desc, c.tag_name
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
$$;

