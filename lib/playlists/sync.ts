import type { SupabaseClient } from '@supabase/supabase-js'

import { fetchUserPlaylistIds } from '@/lib/spotify/api'
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

  const spotifyResult = await fetchUserPlaylistIds(tokenResult.accessToken)
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

  const presentIds: string[] = []
  const missingIds: string[] = []
  for (const playlist of playlistsResult.data) {
    if (
      playlist.spotify_playlist_id !== null &&
      spotifyResult.data.has(playlist.spotify_playlist_id)
    ) {
      presentIds.push(playlist.id)
    } else {
      missingIds.push(playlist.id)
    }
  }

  const checkedAt = new Date().toISOString()
  const updateStatus = async (
    playlistIds: string[],
    spotifyStatus: 'missing' | 'present',
  ) => {
    if (playlistIds.length === 0) return null
    const result = await supabase
      .from('playlists')
      .update({ spotify_status: spotifyStatus, spotify_checked_at: checkedAt })
      .eq('user_id', userId)
      .in('id', playlistIds)
    return result.error
  }

  const [presentError, missingError] = await Promise.all([
    updateStatus(presentIds, 'present'),
    updateStatus(missingIds, 'missing'),
  ])
  const updateError = presentError ?? missingError
  if (updateError !== null) {
    return { status: 'error', message: updateError.message }
  }

  return {
    status: 'ok',
    presentCount: presentIds.length,
    missingCount: missingIds.length,
  }
}
