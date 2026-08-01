-- Limit the write set to the exact local rows read by the sync engine. The
-- expected Spotify id prevents a stale scan from overwriting a row that was
-- recreated while Spotify paging was in flight.
create or replace function public.sync_playlist_spotify_metadata(
  p_playlists jsonb
)
returns table (
  present_count bigint,
  missing_count bigint
)
language sql
volatile
security invoker
set search_path = ''
as $$
  with sync_rows as (
    select
      row.playlist_id,
      row.spotify_playlist_id,
      row.is_present,
      row.name,
      row.description,
      row.image_url
    from jsonb_to_recordset(coalesce(p_playlists, '[]'::jsonb)) as row (
      playlist_id uuid,
      spotify_playlist_id text,
      is_present boolean,
      name text,
      description text,
      image_url text
    )
    where row.playlist_id is not null
  ),
  updates as (
    update public.playlists p
    set
      name = case
        when sync.is_present and sync.name is not null then sync.name
        else p.name
      end,
      description = case
        when sync.is_present then sync.description
        else p.description
      end,
      spotify_image_url = case
        when sync.is_present then sync.image_url
        else null
      end,
      spotify_status = case
        when sync.is_present then 'present'
        else 'missing'
      end,
      spotify_checked_at = now()
    from sync_rows sync
    where p.id = sync.playlist_id
      and p.spotify_playlist_id is not distinct from sync.spotify_playlist_id
    returning p.spotify_status
  )
  select
    count(*) filter (where spotify_status = 'present')::bigint,
    count(*) filter (where spotify_status = 'missing')::bigint
  from updates;
$$;
