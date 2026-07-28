-- Two read helpers for the chat assistant, both security invoker so the
-- existing user_songs/user_genres/user_moods policies do the scoping.
--
-- The chat prompt used to derive both of these app-side by paging user_songs
-- with nested link selects under a row bound, which silently truncated the
-- tag menu once the library outgrew the bound. Postgres can answer both in
-- one query each, with no bound.

-- Every genre/mood actually present in the caller's library — AI-linked or
-- personally tagged. This is the exact vocabulary the assistant is shown and
-- the exact vocabulary it may search, so ids come back alongside names.
-- No enrichment filter: a song with no enrichment has no AI links by
-- construction, and personal tags count regardless of enrichment.
create function public.library_tag_names()
returns table (kind text, id uuid, name text)
language sql
stable
set search_path = ''
as $$
  select 'genre'::text, g.id, g.name
  from public.user_songs us
  join public.song_genres sg on sg.song_id = us.song_id
  join public.genres g on g.id = sg.genre_id
  union
  select 'genre'::text, g.id, g.name
  from public.user_genres ug
  join public.genres g on g.id = ug.genre_id
  union
  select 'mood'::text, m.id, m.name
  from public.user_songs us
  join public.song_moods sm on sm.song_id = us.song_id
  join public.moods m on m.id = sm.mood_id
  union
  select 'mood'::text, m.id, m.name
  from public.user_moods um
  join public.moods m on m.id = um.mood_id;
$$;

revoke execute on function public.library_tag_names()
  from public, anon;

grant execute on function public.library_tag_names()
  to authenticated;

-- The candidate universe for playlist building: enriched OR personally
-- tagged. A song the model never recognized is still selectable once the user
-- has labelled it by hand — their tags carry the same weight as the AI's.
-- The or-across-a-join is what supabase-js cannot express in one call.
-- Ordered here (recency, song_id tiebreak) so the app can page it safely.
create function public.library_selectable_songs()
returns table (song_id uuid, liked_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select us.song_id, us.liked_at
  from public.user_songs us
  join public.songs s on s.id = us.song_id
  where s.enrichment_status = 'enriched'
     or exists (
       select 1 from public.user_genres ug
       where ug.song_id = us.song_id and ug.user_id = us.user_id
     )
     or exists (
       select 1 from public.user_moods um
       where um.song_id = us.song_id and um.user_id = us.user_id
     )
  order by us.liked_at desc nulls last, us.song_id;
$$;

revoke execute on function public.library_selectable_songs()
  from public, anon;

grant execute on function public.library_selectable_songs()
  to authenticated;

-- Supporting indexes: the functions probe the link tables by the trailing
-- column of their composite primary keys, which those keys do not cover.
create index if not exists song_genres_genre_id_idx
  on public.song_genres (genre_id);

create index if not exists song_moods_mood_id_idx
  on public.song_moods (mood_id);

create index if not exists user_genres_song_id_idx
  on public.user_genres (song_id);

create index if not exists user_moods_song_id_idx
  on public.user_moods (song_id);
