// Server-only read for the Library's "no longer available" list: the songs
// the last sync found Spotify will not play for this user. The flag lives on
// `user_songs` (per user, since it follows the listener's market) and is
// restamped by every sync, so this is only as fresh as the latest sync.

import type { SupabaseClient } from '@supabase/supabase-js'

import { type LibrarySongSources } from '@/lib/library/song'
import type { Database } from '@/lib/supabase/types'

/** A dialog list, not a paged table — past this it says it is truncated. */
const UNAVAILABLE_LIST_LIMIT = 500

export type UnavailableSong = {
  id: string
  title: string | null
  artists: string[] | null
  album: string | null
  albumArtUrl: string | null
  spotifyTrackId: string
  sources: LibrarySongSources
}

export type UnavailableSongsResult = {
  songs: UnavailableSong[]
  /** Every unavailable song, which may exceed `songs.length`. */
  totalCount: number
}

/**
 * Newest first, matching the Library's own order. Sources embed through the
 * composite key to `user_songs` — the only key that table has (see
 * ARCHITECTURE.md) — and RLS scopes both reads to the caller.
 */
export const getUnavailableSongs = async (
  supabase: SupabaseClient<Database>,
): Promise<UnavailableSongsResult> => {
  const result = await supabase
    .from('user_songs')
    .select(
      `song_id,
      songs!inner(id, title, artists, album, album_art_url, spotify_track_id),
      user_song_sources(source_type)`,
      { count: 'exact' },
    )
    .eq('is_playable', false)
    .order('liked_at', { ascending: false, nullsFirst: false })
    .order('song_id')
    .limit(UNAVAILABLE_LIST_LIMIT)
  if (result.error !== null) throw new Error(result.error.message)

  const songs = result.data.map((row) => {
    const sources: LibrarySongSources = {
      isLiked: false,
      playlistCount: 0,
      albumCount: 0,
    }
    for (const source of row.user_song_sources) {
      if (source.source_type === 'liked') sources.isLiked = true
      else if (source.source_type === 'playlist') sources.playlistCount += 1
      else if (source.source_type === 'album') sources.albumCount += 1
    }
    return {
      id: row.songs.id,
      title: row.songs.title,
      artists: row.songs.artists,
      album: row.songs.album,
      albumArtUrl: row.songs.album_art_url,
      spotifyTrackId: row.songs.spotify_track_id,
      sources,
    }
  })

  return { songs, totalCount: result.count ?? songs.length }
}
