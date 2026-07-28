-- Completes the index coverage on the personal-tag tables, which are now read
-- on the chat path by library_tag_names/library_selectable_songs.
--
-- user_genres/user_moods are keyed (user_id, song_id, <tag>_id), so both FK
-- columns need their own index for different reasons:
--   * genre_id / mood_id — the chat path filters by tag id when unioning AI
--     and personal links (fetchLinkedSongIds in lib/chat/tools.ts).
--   * song_id — not the leading key column, so cascade deletes from songs
--     have no covering index without it.
-- The performance advisor flags whichever of the two is missing.

create index if not exists user_genres_genre_id_idx
  on public.user_genres (genre_id);

create index if not exists user_moods_mood_id_idx
  on public.user_moods (mood_id);

create index if not exists user_genres_song_id_idx
  on public.user_genres (song_id);

create index if not exists user_moods_song_id_idx
  on public.user_moods (song_id);
