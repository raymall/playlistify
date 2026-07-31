-- Cached reachability from the latest user-triggered Spotify playlist scan.
alter table public.playlists
  add column spotify_status text not null default 'unknown'
    check (spotify_status in ('unknown', 'present', 'missing')),
  add column spotify_checked_at timestamptz;

-- Effective tags behind every playlist owned by the caller, rolled up in one
-- RLS-scoped query. `kind` preserves both tag type and source so the page can
-- distinguish canonical AI tags from the user's personal additions.
create function public.playlist_tag_summary()
returns table (
  playlist_id uuid,
  kind text,
  name text,
  song_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select tags.playlist_id, tags.kind, tags.name,
    count(distinct tags.song_id)::bigint as song_count
  from (
    select p.id as playlist_id, 'ai_genre'::text as kind, g.name, ps.song_id
    from public.playlists p
    join public.playlist_songs ps on ps.playlist_id = p.id
    join public.songs s on s.id = ps.song_id
    join public.song_genres sg on sg.song_id = ps.song_id
    join public.genres g on g.id = sg.genre_id
    where s.enrichment_status = 'enriched'
      and s.ai_confidence > 0.5
      and not exists (
        select 1
        from public.user_genre_suppressions ugs
        where ugs.user_id = p.user_id
          and ugs.song_id = ps.song_id
          and ugs.genre_id = sg.genre_id
      )
    union all
    select p.id, 'ai_mood'::text, m.name, ps.song_id
    from public.playlists p
    join public.playlist_songs ps on ps.playlist_id = p.id
    join public.songs s on s.id = ps.song_id
    join public.song_moods sm on sm.song_id = ps.song_id
    join public.moods m on m.id = sm.mood_id
    where s.enrichment_status = 'enriched'
      and s.ai_confidence > 0.5
      and not exists (
        select 1
        from public.user_mood_suppressions ums
        where ums.user_id = p.user_id
          and ums.song_id = ps.song_id
          and ums.mood_id = sm.mood_id
      )
    union all
    select p.id, 'personal_genre'::text, g.name, ps.song_id
    from public.playlists p
    join public.playlist_songs ps on ps.playlist_id = p.id
    join public.user_genres ug
      on ug.user_id = p.user_id
      and ug.song_id = ps.song_id
    join public.genres g on g.id = ug.genre_id
    union all
    select p.id, 'personal_mood'::text, m.name, ps.song_id
    from public.playlists p
    join public.playlist_songs ps on ps.playlist_id = p.id
    join public.user_moods um
      on um.user_id = p.user_id
      and um.song_id = ps.song_id
    join public.moods m on m.id = um.mood_id
  ) tags
  group by tags.playlist_id, tags.kind, tags.name;
$$;

revoke execute on function public.playlist_tag_summary()
  from public, anon;

grant execute on function public.playlist_tag_summary()
  to authenticated;
