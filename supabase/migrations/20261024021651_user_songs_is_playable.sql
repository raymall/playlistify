-- Songs Spotify no longer plays for this user.
--
-- Every track Spotify returns carries `is_playable`, resolved against the
-- listener's own market — a song can be playable in one country and greyed
-- out in another, so the flag is per user and lives on `user_songs`, never on
-- the shared `songs` row. The sync restamps it every time any source re-reads
-- the song. Null means no sync has checked the song since the column existed.
--
-- The existing `user_songs_all_own` policy already covers the column: RLS
-- scopes reads to the caller, and the sync writes through the service role.

alter table public.user_songs
  add column is_playable boolean;

-- The Library's "no longer available" list is the only reader that filters on
-- the flag, and it is a small slice of any library.
create index user_songs_unplayable_idx
  on public.user_songs (user_id)
  where is_playable = false;

-- Same contract as before (see 20260908214641_user_song_sources.sql), plus
-- the flag: a new row takes it from the source, and an existing row is
-- restamped with it unless the source could not say.
create or replace function public.import_user_songs_from_source(
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

  insert into public.user_songs
    (user_id, song_id, liked_at, imported_at, is_playable)
  select p_user_id, row.song_id, row.added_at, p_synced_at, row.is_playable
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
    as row (song_id uuid, added_at timestamptz, is_playable boolean)
  where row.song_id is not null and row.added_at is not null
  on conflict (user_id, song_id) do update
  set
    imported_at = excluded.imported_at,
    is_playable = coalesce(
      excluded.is_playable,
      public.user_songs.is_playable
    );
end;
$$;
