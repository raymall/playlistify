-- Searchable flattened artist names. songs.artists is text[], which ilike
-- cannot scan directly, so library search could previously match title/album
-- only. array_to_string is merely STABLE, so a generated column needs an
-- IMMUTABLE wrapper (deterministic for a text[] joined by a constant delimiter).
create or replace function public.songs_artists_search(arr text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_to_string(arr, ' '), '')
$$;

alter table public.songs
  add column artists_search text
  generated always as (public.songs_artists_search(artists)) stored;
