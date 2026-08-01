import type { SupabaseClient } from '@supabase/supabase-js'

import { fetchUserPlaylists } from '@/lib/spotify/api'
import { getValidSpotifyToken } from '@/lib/spotify/token'
import type { Database } from '@/lib/supabase/types'

export type SyncPlaylistStatusesResponse =
  | { status: 'ok'; presentCount: number; missingCount: number }
  | { status: 'reconnect_required' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error'; message: string }

export const syncPlaylistStatuses = async (
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<SyncPlaylistStatusesResponse> => {
  const playlistsResult = await supabase
    .from('playlists')
    .select('id, spotify_playlist_id')
    .eq('user_id', userId)
  if (playlistsResult.error) {
    return { status: 'error', message: playlistsResult.error.message }
  }

  const tokenResult = await getValidSpotifyToken(userId)
  if (tokenResult.status === 'reconnect_required') {
    return { status: 'reconnect_required' }
  }
  if (tokenResult.status === 'error') {
    return { status: 'error', message: tokenResult.message }
  }

  const spotifyResult = await fetchUserPlaylists(tokenResult.accessToken)
  if (spotifyResult.status === 'auth_failed') {
    return { status: 'reconnect_required' }
  }
  if (spotifyResult.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfterSeconds: spotifyResult.retryAfterSeconds,
    }
  }
  if (spotifyResult.status === 'error') {
    return { status: 'error', message: spotifyResult.message }
  }

  const spotifyPlaylists = []
  for (const playlist of playlistsResult.data) {
    const spotifyPlaylist =
      playlist.spotify_playlist_id === null
        ? undefined
        : spotifyResult.data.get(playlist.spotify_playlist_id)
    spotifyPlaylists.push({
      playlist_id: playlist.id,
      spotify_playlist_id: playlist.spotify_playlist_id,
      is_present: spotifyPlaylist !== undefined,
      name: spotifyPlaylist?.name ?? null,
      description: spotifyPlaylist?.description ?? null,
      image_url: spotifyPlaylist?.imageUrl ?? null,
    })
  }

  const syncResult = await supabase.rpc('sync_playlist_spotify_metadata', {
    p_playlists: spotifyPlaylists,
  })
  if (syncResult.error) {
    return { status: 'error', message: syncResult.error.message }
  }
  const counts = syncResult.data[0]

  return {
    status: 'ok',
    presentCount: counts.present_count,
    missingCount: counts.missing_count,
  }
}
