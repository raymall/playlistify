-- PostgREST treats a table that carries foreign keys to two other tables as a
-- junction between them. user_song_sources' direct keys to profiles and songs
-- therefore made every `user_songs → songs` embed ambiguous ("more than one
-- relationship was found") and broke the Library page, chat candidate fetch,
-- and playlist track resolution the moment the table existed.
--
-- The composite key to user_songs already guarantees that both the profile
-- and the song exist, and cascades from both of them, so the direct keys were
-- redundant. Drop them, along with the index that only served the songs key.
-- The sync engine looks up Spotify ids for stale source rows in chunks
-- instead of embedding songs from this table.

alter table public.user_song_sources
  drop constraint user_song_sources_user_id_fkey,
  drop constraint user_song_sources_song_id_fkey;

drop index public.user_song_sources_song_id_idx;
