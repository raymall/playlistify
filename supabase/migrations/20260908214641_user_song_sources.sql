-- Whole-library sync: per-source membership behind each user_songs row.
--
-- A song stays in a user's library while at least one Spotify source still
-- holds it — Liked Songs, an owned playlist, or a saved album — and leaves
-- only when a completed sync finds it in none of them. `user_songs` is still
-- the library (one row per user/song; `liked_at` now means "added to the
-- library at" and stays non-null by construction). This table records *why*
-- each row is there, so removal can be decided per source.
--
-- All writes are service-role: the sync engine upserts a row for every
-- (source, song) it reads and, after a completed pass, deletes the rows that
-- pass did not re-see. Users may only read their own rows.

create table public.user_song_sources (
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  source_type text not null
    check (source_type in ('liked', 'playlist', 'album')),
  -- Spotify playlist or album id; '' for liked (a PK column cannot be null).
  source_id text not null default '',
  -- When the source itself says the song was added (Spotify's added_at, or
  -- the album's saved-at for every track on it).
  added_at timestamptz not null,
  -- The sync's server-issued start time, restamped every time the source is
  -- re-read. After a completed pass, rows older than that pass's start are
  -- exactly the (source, song) pairs it did not see.
  last_seen_at timestamptz not null,
  primary key (user_id, song_id, source_type, source_id),
  foreign key (user_id, song_id)
    references public.user_songs (user_id, song_id) on delete cascade
);

-- The completed-pass stale scan is per user and source type; the song_id
-- index covers the songs FK (the PK prefix already covers the other two).
create index user_song_sources_user_type_seen_idx
  on public.user_song_sources (user_id, source_type, last_seen_at);
create index user_song_sources_song_id_idx
  on public.user_song_sources (song_id);

alter table public.user_song_sources enable row level security;

create policy "user_song_sources_select_own"
  on public.user_song_sources for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Library rows for songs seen through a playlist or album. A new row takes
-- the source's added_at as its liked_at ("added to the library at"), which
-- keeps the canonical library order non-null; an existing row keeps its
-- liked_at — a Liked Songs date must not be overwritten by a later playlist
-- date — and only has its sync marker refreshed. PostgREST's upsert cannot
-- update a column subset, hence SQL.
create function public.import_user_songs_from_source(
  p_user_id uuid,
  p_rows jsonb,
  p_synced_at timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_user_id is null or p_synced_at is null then
    raise exception 'user id and sync marker are required';
  end if;

  insert into public.user_songs (user_id, song_id, liked_at, imported_at)
  select p_user_id, row.song_id, row.added_at, p_synced_at
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
    as row (song_id uuid, added_at timestamptz)
  where row.song_id is not null and row.added_at is not null
  on conflict (user_id, song_id) do update
  set imported_at = excluded.imported_at;
end;
$$;

revoke execute on function
  public.import_user_songs_from_source(uuid, jsonb, timestamptz)
  from public, anon, authenticated;

grant execute on function
  public.import_user_songs_from_source(uuid, jsonb, timestamptz)
  to service_role;

-- Drop the library rows no source holds any more. Runs only after a completed
-- sync has deleted the stale source rows; returns how many songs left.
create function public.prune_user_songs_without_sources(p_user_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer;
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  delete from public.user_songs us
  where us.user_id = p_user_id
    and not exists (
      select 1
      from public.user_song_sources uss
      where uss.user_id = us.user_id and uss.song_id = us.song_id
    );

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function
  public.prune_user_songs_without_sources(uuid)
  from public, anon, authenticated;

grant execute on function
  public.prune_user_songs_without_sources(uuid)
  to service_role;

-- Every existing library row came from Liked Songs. Its imported_at is the
-- marker of the last sync that saw it, so it doubles as last_seen_at.
insert into public.user_song_sources
  (user_id, song_id, source_type, source_id, added_at, last_seen_at)
select
  user_id,
  song_id,
  'liked',
  '',
  coalesce(liked_at, imported_at),
  imported_at
from public.user_songs;
