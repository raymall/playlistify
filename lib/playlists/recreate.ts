import type { SupabaseClient } from '@supabase/supabase-js'

import { buildSpotifyPlaylist } from '@/lib/playlists/build'
import { resolveTrackIds } from '@/lib/playlists/tracks'
import { getValidSpotifyToken } from '@/lib/spotify/token'
import type { Database } from '@/lib/supabase/types'

export type RecreatePlaylistResponse =
  | {
      status: 'recreated'
      spotifyPlaylistId: string
      spotifyUrl: string
      addedCount: number
      requestedCount: number
    }
  | { status: 'reconnect_required' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error'; message: string }

export const recreatePlaylistForUser = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  playlistId: string,
): Promise<RecreatePlaylistResponse> => {
  const [playlistResult, songsResult] = await Promise.all([
    supabase
      .from('playlists')
      .select('name, description')
      .eq('id', playlistId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('playlist_songs')
      .select('song_id')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true }),
  ])
  if (playlistResult.error) {
    return { status: 'error', message: playlistResult.error.message }
  }
  if (songsResult.error) {
    return { status: 'error', message: songsResult.error.message }
  }
  if (playlistResult.data === null) {
    return { status: 'error', message: 'Playlist not found.' }
  }

  const songIds = songsResult.data.map((row) => row.song_id)
  const resolved = await resolveTrackIds(supabase, songIds, 'skip')
  if (resolved.status === 'error') return resolved
  if (resolved.trackIds.length === 0) {
    return {
      status: 'error',
      message: "None of this playlist's songs are still in your library.",
    }
  }

  const tokenResult = await getValidSpotifyToken(userId)
  if (tokenResult.status === 'reconnect_required') {
    return { status: 'reconnect_required' }
  }
  if (tokenResult.status === 'error') {
    return { status: 'error', message: tokenResult.message }
  }

  const buildResult = await buildSpotifyPlaylist(tokenResult.accessToken, {
    name: playlistResult.data.name ?? 'Untitled playlist',
    description: playlistResult.data.description ?? '',
    trackIds: resolved.trackIds,
  })
  if (buildResult.status !== 'built') return buildResult

  const checkedAt = new Date().toISOString()
  const updateResult = await supabase
    .from('playlists')
    .update({
      spotify_playlist_id: buildResult.spotifyPlaylistId,
      spotify_image_url: null,
      spotify_status: 'present',
      spotify_checked_at: checkedAt,
    })
    .eq('id', playlistId)
    .eq('user_id', userId)
  if (updateResult.error) {
    return { status: 'error', message: updateResult.error.message }
  }

  return {
    status: 'recreated',
    spotifyPlaylistId: buildResult.spotifyPlaylistId,
    spotifyUrl: buildResult.spotifyUrl,
    addedCount: buildResult.addedCount,
    requestedCount: songIds.length,
  }
}
