import { mapSpotifyFailure } from '@/lib/playlists/spotify-failures'
import {
  addPlaylistTracksChunk,
  createSpotifyPlaylist,
  deleteSpotifyPlaylist,
  PLAYLIST_ADD_CHUNK_SIZE,
  type SpotifyApiResult,
} from '@/lib/spotify/api'

type BuildSpotifyPlaylistParams = {
  name: string
  description: string
  trackIds: string[]
}

export type BuildSpotifyPlaylistResponse =
  | {
      status: 'built'
      spotifyPlaylistId: string
      spotifyUrl: string
      addedCount: number
    }
  | { status: 'reconnect_required' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error'; message: string }

const spotifyPlaylistUrl = (id: string, url: string | null): string =>
  url ?? `https://open.spotify.com/playlist/${id}`

/**
 * Create a private Spotify playlist and add tracks in order. A failure after
 * at least one chunk leaves that useful prefix in place; a zero-track result
 * removes the empty shell created by this call.
 */
export const buildSpotifyPlaylist = async (
  accessToken: string,
  { name, description, trackIds }: BuildSpotifyPlaylistParams,
): Promise<BuildSpotifyPlaylistResponse> => {
  const createResult = await createSpotifyPlaylist(accessToken, {
    name,
    description,
  })
  if (createResult.status !== 'ok') return mapSpotifyFailure(createResult)

  const playlist = createResult.data
  let addedCount = 0
  let addFailure: SpotifyApiResult<null> | null = null
  for (
    let index = 0;
    index < trackIds.length;
    index += PLAYLIST_ADD_CHUNK_SIZE
  ) {
    const chunk = trackIds.slice(index, index + PLAYLIST_ADD_CHUNK_SIZE)
    const addResult = await addPlaylistTracksChunk(
      accessToken,
      playlist.id,
      chunk,
    )
    if (addResult.status !== 'ok') {
      addFailure = addResult
      break
    }
    addedCount += chunk.length
  }

  if (addedCount === 0) {
    const cleanup = await deleteSpotifyPlaylist(accessToken, playlist.id)
    if (cleanup.status !== 'ok') {
      console.error('[playlists] empty-playlist cleanup failed')
    }
    if (addFailure?.status === 'auth_failed') {
      return { status: 'reconnect_required' }
    }
    if (addFailure?.status === 'rate_limited') {
      return {
        status: 'rate_limited',
        retryAfterSeconds: addFailure.retryAfterSeconds,
      }
    }
    return {
      status: 'error',
      message:
        addFailure?.status === 'error'
          ? `Could not add songs to the playlist: ${addFailure.message}`
          : 'Could not add any songs to the playlist.',
    }
  }

  return {
    status: 'built',
    spotifyPlaylistId: playlist.id,
    spotifyUrl: spotifyPlaylistUrl(playlist.id, playlist.url),
    addedCount,
  }
}
