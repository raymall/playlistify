import type { SupabaseClient } from '@supabase/supabase-js'

import { deleteSpotifyPlaylist } from '@/lib/spotify/api'
import { getValidSpotifyToken } from '@/lib/spotify/token'
import type { Database } from '@/lib/supabase/types'

export type DeletePlaylistResponse =
  | { status: 'deleted'; didDeleteSpotify: boolean }
  | { status: 'reconnect_required' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error'; message: string }

export const deletePlaylistForUser = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  playlistId: string,
): Promise<DeletePlaylistResponse> => {
  const playlistResult = await supabase
    .from('playlists')
    .select('spotify_playlist_id, spotify_status')
    .eq('id', playlistId)
    .eq('user_id', userId)
    .maybeSingle()
  if (playlistResult.error) {
    return { status: 'error', message: playlistResult.error.message }
  }
  if (playlistResult.data === null) {
    return { status: 'error', message: 'Playlist not found.' }
  }

  let didDeleteSpotify = false
  const { spotify_playlist_id: spotifyPlaylistId, spotify_status: status } =
    playlistResult.data
  if (spotifyPlaylistId !== null && status !== 'missing') {
    const tokenResult = await getValidSpotifyToken(userId)
    if (tokenResult.status === 'ok') {
      const spotifyResult = await deleteSpotifyPlaylist(
        tokenResult.accessToken,
        spotifyPlaylistId,
      )
      didDeleteSpotify = spotifyResult.status === 'ok'
      if (spotifyResult.status !== 'ok') {
        console.error('[playlists] Spotify unfollow failed during delete')
      }
    } else {
      console.error('[playlists] Spotify token unavailable during delete')
    }
  }

  const deleteResult = await supabase
    .from('playlists')
    .delete()
    .eq('id', playlistId)
    .eq('user_id', userId)
  if (deleteResult.error) {
    return { status: 'error', message: deleteResult.error.message }
  }

  return { status: 'deleted', didDeleteSpotify }
}
