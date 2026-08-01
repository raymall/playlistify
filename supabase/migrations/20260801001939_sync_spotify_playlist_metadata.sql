-- Spotify playlist image URLs are temporary, so the mount-triggered metadata
-- sync refreshes this cache together with title, description, and reachability.
alter table public.playlists
  add column spotify_image_url text;

-- Apply one caller-scoped Spotify snapshot without issuing one database write
-- per playlist. Security invoker keeps the existing playlists_all_own RLS
-- policy authoritative; no user id is accepted from the client.
create function public.sync_playlist_spotify_metadata(p_playlists jsonb)
returns table (
  present_count bigint,
  missing_count bigint
)
language sql
volatile
security invoker
set search_path = ''
as $$
  with spotify_rows as (
    select
      row.spotify_playlist_id,
      row.name,
      row.description,
      row.image_url
    from jsonb_to_recordset(coalesce(p_playlists, '[]'::jsonb)) as row (
      spotify_playlist_id text,
      name text,
      description text,
      image_url text
    )
    where row.spotify_playlist_id is not null
  ),
  present_updates as (
    update public.playlists p
    set
      name = spotify.name,
      description = spotify.description,
      spotify_image_url = spotify.image_url,
      spotify_status = 'present',
      spotify_checked_at = now()
    from spotify_rows spotify
    where p.spotify_playlist_id = spotify.spotify_playlist_id
    returning p.id
  ),
  missing_updates as (
    update public.playlists p
    set
      spotify_image_url = null,
      spotify_status = 'missing',
      spotify_checked_at = now()
    where not exists (
      select 1
      from spotify_rows spotify
      where spotify.spotify_playlist_id = p.spotify_playlist_id
    )
    returning p.id
  )
  select
    (select count(*) from present_updates)::bigint,
    (select count(*) from missing_updates)::bigint;
$$;

revoke execute on function public.sync_playlist_spotify_metadata(jsonb)
  from public, anon;

grant execute on function public.sync_playlist_spotify_metadata(jsonb)
  to authenticated;
