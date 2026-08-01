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

  const playlistResult = await supabase
    .from('playlists')
    .select('spotify_playlist_id, spotify_status')
    .eq('id', payload.playlistId)
    .eq('user_id', userId)
    .maybeSingle()
  if (playlistResult.error) {
    return { status: 'error', message: playlistResult.error.message }
  }
  if (playlistResult.data === null) {
    return { status: 'error', message: 'Playlist not found.' }
  }

  const { spotify_playlist_id: spotifyPlaylistId, spotify_status: status } =
    playlistResult.data
  if (spotifyPlaylistId === null || status === 'missing') {
    const localResult = await supabase
      .from('playlists')
      .update({
        name,
        description: description.length > 0 ? description : null,
      })
      .eq('id', payload.playlistId)
      .eq('user_id', userId)
    if (localResult.error) {
      return { status: 'error', message: localResult.error.message }
    }
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

  const localResult = await supabase
    .from('playlists')
    .update({
      name,
      description: description.length > 0 ? description : null,
    })
    .eq('id', payload.playlistId)
    .eq('user_id', userId)
  if (localResult.error) {
    return { status: 'error', message: localResult.error.message }
  }

  return { status: 'updated', didUpdateSpotify: true }
}
