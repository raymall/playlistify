-- Database-side library search: free text, AND-combined genre/mood filters,
-- exact counting, and paging, plus the typeahead that feeds the filter pills.
--
-- Replaces the app-side `.or(...ilike...)` + `.range()` query on /library,
-- which sequential-scanned the global songs table and ordered by liked_at with
-- no tiebreak (equal liked_at values shuffled between pages).
--
-- DISPLAY vs SELECTION. Two deliberately different effective-tag rules live in
-- this schema now:
--   * library_effective_tagged_songs (unchanged) gates AI links on
--     ai_confidence > 0.5 — the quality bar for what the assistant may build a
--     playlist from.
--   * library_search_page / library_tag_suggestions (below) apply no
--     confidence gate, because they filter what the Library *shows*. Clicking a
--     chip you can see must find the row it was on.
-- Both subtract the caller's suppressions and union the caller's own links.

create extension if not exists pg_trgm with schema extensions;

-- ────────────────────────────────────────────────────────────────────────
-- Helpers
-- ────────────────────────────────────────────────────────────────────────

-- Escapes the LIKE metacharacters so a user-typed `50%` or `Song_1` matches
-- literally. The app no longer sanitizes the query at all, so this is the only
-- thing standing between a typed `%` and a wildcard.
create or replace function public.like_escape(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select replace(replace(replace(p_value, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- The SQL twin of lib/vocabulary.ts normalizeTagName, so a tag typed into the
-- typeahead resolves the same way it would on a write.
create or replace function public.normalize_tag_name(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select regexp_replace(btrim(lower(p_name)), '\s+', ' ', 'g')
$$;

-- ────────────────────────────────────────────────────────────────────────
-- Fused search column
-- ────────────────────────────────────────────────────────────────────────

-- title + artists, pre-lowered, in one column: one GIN index instead of two
-- (half the write amplification on the import/enrichment path) and the
-- `title OR artists_search` disjunction collapses into a single index qual.
-- A generated column may not reference another generated column, so this calls
-- the IMMUTABLE songs_artists_search on the base artists array rather than
-- reading artists_search.
alter table public.songs
  add column search_text text
  generated always as (
    lower(coalesce(title, '') || ' ' || public.songs_artists_search(artists))
  ) stored;

-- ────────────────────────────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────────────────────────────

-- The canonical library order, as a pure ordered index scan (no sort at any
-- page), with the per-user count index-only. `desc nulls last` is spelled out
-- because DESC defaults to NULLS FIRST — the bug this replaces, where un-liked
-- imports led the library.
create index user_songs_user_liked_song_idx
  on public.user_songs (user_id, liked_at desc nulls last, song_id);

-- Free-text seed predicate.
create index songs_search_text_trgm_idx
  on public.songs using gin (search_text extensions.gin_trgm_ops);

-- Typeahead substring match over the vocabularies.
create index genres_name_trgm_idx
  on public.genres using gin (name extensions.gin_trgm_ops);

create index moods_name_trgm_idx
  on public.moods using gin (name extensions.gin_trgm_ops);

-- Tag containment, AI arms. The PK is (song_id, genre_id) and cannot serve a
-- genre_id lookup; making the replacement covering makes each arm index-only.
create index song_genres_genre_song_idx
  on public.song_genres (genre_id, song_id);

create index song_moods_mood_song_idx
  on public.song_moods (mood_id, song_id);

drop index if exists public.song_genres_genre_id_idx;
drop index if exists public.song_moods_mood_id_idx;

-- Tag containment + typeahead, personal arms. The tag id leads (not user_id)
-- so one index covers both the `<tag>_id = any($1) and user_id = $2` seek and
-- the genres/moods FK cascade — (user_id, genre_id, song_id) would leave that
-- FK unindexed and trip the performance advisor.
create index user_genres_genre_user_song_idx
  on public.user_genres (genre_id, user_id, song_id);

create index user_moods_mood_user_song_idx
  on public.user_moods (mood_id, user_id, song_id);

drop index if exists public.user_genres_genre_id_idx;
drop index if exists public.user_moods_mood_id_idx;

-- user_genres_song_id_idx / user_moods_song_id_idx stay: they cover the
-- cascade from songs, which the reordered indexes above do not.

-- ────────────────────────────────────────────────────────────────────────
-- Search
-- ────────────────────────────────────────────────────────────────────────

-- One page of the library, filtered by free text (AND across terms, each
-- matching title-or-artist) and by AND-combined genre/mood pills, plus the
-- exact filtered count fused onto every row.
--
-- Returns thin rows on purpose: the app hydrates song detail and the six tag
-- embeds with a follow-up `.in('song_id', ids)`, the pattern
-- lib/chat/library-search.ts already uses. A fat jsonb row would type as `Json`
-- and lose every generated nested type.
--
-- plan_cache_mode is load-bearing. Both filter guards are
-- `<param-derived constant> = 0 OR <real predicate>`; under a generic plan the
-- planner sees an opaque OR and can use no index for either branch. Under a
-- custom plan the arguments are constants at plan time, so with no terms the OR
-- folds away, nothing references `s`, the left join is removed, and the plan is
-- Limit → Index Scan on user_songs_user_liked_song_idx with no sort and no heap
-- access to songs.
create or replace function public.library_search_page(
  p_terms text[] default '{}'::text[],
  p_genres text[] default '{}'::text[],
  p_moods text[] default '{}'::text[],
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
    -- One row per (song, selected tag) the song carries for this caller.
    -- The vocabulary join sits INSIDE each arm deliberately: `g.name = any($n)`
    -- is a plain Param qual on a unique index. Resolving names to ids in a
    -- separate CTE would put a SubPlan in the qual, and a SubPlan-bearing qual
    -- is never pushed into a set-operation arm — every index scan below would
    -- silently vanish.
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
    -- Relational division across both kinds at once. The union above already
    -- deduped (song_id, tag_id), so count(*) is the distinct tag count. The
    -- target counts INPUT names, never resolved ids, so a pill naming a
    -- nonexistent tag makes the target unreachable and correctly yields zero.
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
    -- LEFT, not INNER: song_id is NOT NULL with an FK to the unique songs.id so
    -- the two are equivalent, but only a LEFT JOIN is eligible for join
    -- removal — with no search terms the planner drops the songs access.
    left join public.songs s on s.id = us.song_id
    where us.user_id = (select auth.uid())
      and (
        cardinality(coalesce(p_terms, '{}'::text[])) = 0
        or (
          -- Seed term (the app sends terms longest-first): a bare positive LIKE
          -- on one relation, so the trigram GIN is usable as an index qual. The
          -- rest are recheck filters over the seed's output — a pattern coming
          -- from a correlated unnest() can never use the index.
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
  )
  select
    f.song_id,
    f.liked_at,
    -- SubPlan under a CASE arm: never executed when p_with_count is false, so
    -- an unfiltered page load does zero counting work. A count(*) over ()
    -- window would buffer every filtered row in a tuplestore instead, and could
    -- not be made conditional.
    case when p_with_count then (select count(*) from filtered) end
  from filtered f
  order by f.liked_at desc nulls last, f.song_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function
  public.library_search_page(text[], text[], text[], integer, integer, boolean)
  from public, anon;

grant execute on function
  public.library_search_page(text[], text[], text[], integer, integer, boolean)
  to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- Typeahead
-- ────────────────────────────────────────────────────────────────────────

-- Filter-pill suggestions for a typed query: matching vocabulary names that
-- actually occur in the caller's library, with a capped head count each.
--
-- Vocabulary-first, then probe into the library. The inverse — aggregating the
-- caller's whole effective-link set and filtering by name — would compute
-- counts for every tag in the library on every keystroke. Worst case here is
-- bounded at ~40k index tuples regardless of library or vocabulary size:
-- small name-indexed tables first, shortlist capped at 50, then at most
-- 4 x (cap + 1) tuples per candidate through index-only scans.
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

revoke execute on function
  public.library_tag_suggestions(text, integer, integer)
  from public, anon;

grant execute on function
  public.library_tag_suggestions(text, integer, integer)
  to authenticated;
