import type { SupabaseClient } from '@supabase/supabase-js'

import {
  PLAYLIST_DESCRIPTION_MAX,
  PLAYLIST_NAME_MAX,
} from '@/lib/playlists/validation'
import { updateSpotifyPlaylistDetails } from '@/lib/spotify/api'
import { getValidSpotifyToken } from '@/lib/spotify/token'
import type { Database } from '@/lib/supabase/types'

export type UpdatePlaylistDetailsPayload = {
  playlistId: string
  name: string
  description: string
}

export type UpdatePlaylistDetailsResponse =
  | { status: 'updated'; didUpdateSpotify: boolean }
  | { status: 'reconnect_required' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error'; message: string }

export const updatePlaylistDetails = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  payload: UpdatePlaylistDetailsPayload,
): Promise<UpdatePlaylistDetailsResponse> => {
  const name = payload.name.trim()
  const description = payload.description.trim()
  if (
    name.length === 0 ||
    name.length > PLAYLIST_NAME_MAX ||
    description.length > PLAYLIST_DESCRIPTION_MAX
  ) {
    return { status: 'error', message: 'Invalid playlist details.' }
  }

  const updateResult = await supabase
    .from('playlists')
    .update({
      name,
      description: description.length > 0 ? description : null,
    })
    .eq('id', payload.playlistId)
    .eq('user_id', userId)
    .select('spotify_playlist_id, spotify_status')
    .maybeSingle()
  if (updateResult.error) {
    return { status: 'error', message: updateResult.error.message }
  }
  if (updateResult.data === null) {
    return { status: 'error', message: 'Playlist not found.' }
  }

  const { spotify_playlist_id: spotifyPlaylistId, spotify_status: status } =
    updateResult.data
  if (spotifyPlaylistId === null || status === 'missing') {
    return { status: 'updated', didUpdateSpotify: false }
  }

  const tokenResult = await getValidSpotifyToken(userId)
  if (tokenResult.status === 'reconnect_required') {
    return { status: 'reconnect_required' }
  }
  if (tokenResult.status === 'error') {
    return { status: 'error', message: tokenResult.message }
  }

  const spotifyResult = await updateSpotifyPlaylistDetails(
    tokenResult.accessToken,
    spotifyPlaylistId,
    { name, description },
  )
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

  return { status: 'updated', didUpdateSpotify: true }
}
