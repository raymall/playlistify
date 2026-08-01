// Live Spotify playlist verification: creates a private throwaway playlist,
// confirms it appears in the current user's playlist listing, adds one saved
// track, waits for its cover, updates and reads back its details from that same
// listing, unfollows it, and confirms it no longer appears. Cleanup runs even
// when an intermediate assertion fails.
//
// Usage: node --env-file=.env.local --import tsx scripts/verify-playlists.mts
import { createClient } from '@supabase/supabase-js'

import {
  addPlaylistTracksChunk,
  createSpotifyPlaylist,
  deleteSpotifyPlaylist,
  fetchUserPlaylists,
  type SpotifyPlaylistMetadata,
  updateSpotifyPlaylistDetails,
} from '../lib/spotify/api'
import { getValidSpotifyToken } from '../lib/spotify/token'
import type { Database } from '../lib/supabase/types'
import { requireEnv } from './lib/env.mjs'

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

const LIST_RETRIES = 15
const LIST_RETRY_DELAY_MS = 1_000

const service = createClient<Database>(url, serviceKey)

const tokenRow = await service
  .from('spotify_tokens')
  .select('user_id')
  .limit(1)
  .maybeSingle()
if (tokenRow.error || tokenRow.data === null) {
  console.error('No Spotify token row — sign in and reconnect Spotify first.')
  process.exit(1)
}

const tokenResult = await getValidSpotifyToken(tokenRow.data.user_id)
if (tokenResult.status !== 'ok') {
  console.error('Could not obtain a Spotify access token:', tokenResult.status)
  process.exit(1)
}
const { accessToken } = tokenResult

const songResult = await service
  .from('user_songs')
  .select('songs!inner(spotify_track_id)')
  .eq('user_id', tokenRow.data.user_id)
  .limit(1)
  .maybeSingle()
if (songResult.error || songResult.data === null) {
  console.error('No saved song is available for the playlist smoke test.')
  process.exit(1)
}

const waitForPlaylist = async (
  playlistId: string,
  predicate: (playlist: SpotifyPlaylistMetadata | undefined) => boolean,
): Promise<boolean> => {
  for (let attempt = 0; attempt < LIST_RETRIES; attempt += 1) {
    const listResult = await fetchUserPlaylists(accessToken)
    if (listResult.status !== 'ok') {
      throw new Error(`Playlist listing failed: ${listResult.status}`)
    }
    if (predicate(listResult.data.get(playlistId))) return true
    await new Promise<void>((resolve) => {
      setTimeout(resolve, LIST_RETRY_DELAY_MS)
    })
  }
  return false
}

const createdName = `Playlistify smoke ${new Date().toISOString()}`
const updatedName = `${createdName} updated`
const updatedDescription = 'Temporary Playlistify endpoint verification'
let playlistId: string | null = null
let hasUnfollowed = false
let failedMessage: string | null = null

try {
  const createResult = await createSpotifyPlaylist(accessToken, {
    name: createdName,
    description: '',
  })
  if (createResult.status !== 'ok') {
    throw new Error(`Playlist creation failed: ${createResult.status}`)
  }
  playlistId = createResult.data.id
  console.log('PASS  created a private throwaway playlist')

  if (
    !(await waitForPlaylist(playlistId, (playlist) => playlist !== undefined))
  ) {
    throw new Error('Created playlist did not appear in GET /me/playlists')
  }
  console.log('PASS  playlist appeared in GET /me/playlists')

  const addResult = await addPlaylistTracksChunk(accessToken, playlistId, [
    songResult.data.songs.spotify_track_id,
  ])
  if (addResult.status !== 'ok') {
    throw new Error(`Adding a playlist item failed: ${addResult.status}`)
  }
  console.log('PASS  added one saved track through /playlists/{id}/items')

  if (
    !(await waitForPlaylist(
      playlistId,
      (playlist) => playlist !== undefined && playlist.imageUrl !== null,
    ))
  ) {
    throw new Error('Spotify did not generate a playlist cover in time')
  }
  console.log('PASS  generated cover appeared in GET /me/playlists')

  const updateResult = await updateSpotifyPlaylistDetails(
    accessToken,
    playlistId,
    { name: updatedName, description: updatedDescription },
  )
  if (updateResult.status !== 'ok') {
    throw new Error(`Playlist detail update failed: ${updateResult.status}`)
  }

  if (
    !(await waitForPlaylist(
      playlistId,
      (playlist) =>
        playlist?.name === updatedName &&
        playlist.description === updatedDescription,
    ))
  ) {
    throw new Error(
      'Updated playlist details did not read back from GET /me/playlists',
    )
  }
  console.log(
    'PASS  updated title and description appeared in GET /me/playlists',
  )

  const deleteResult = await deleteSpotifyPlaylist(accessToken, playlistId)
  if (deleteResult.status !== 'ok') {
    throw new Error(`Playlist unfollow failed: ${deleteResult.status}`)
  }
  hasUnfollowed = true

  if (
    !(await waitForPlaylist(playlistId, (playlist) => playlist === undefined))
  ) {
    throw new Error('Unfollowed playlist still appears in GET /me/playlists')
  }
  console.log('PASS  unfollowed playlist disappeared from GET /me/playlists')
} catch (error) {
  failedMessage = error instanceof Error ? error.message : 'Unknown failure'
} finally {
  if (playlistId !== null && !hasUnfollowed) {
    const cleanupResult = await deleteSpotifyPlaylist(accessToken, playlistId)
    if (cleanupResult.status !== 'ok') {
      const cleanupMessage = `cleanup failed: ${cleanupResult.status}`
      failedMessage =
        failedMessage === null
          ? cleanupMessage
          : `${failedMessage}; ${cleanupMessage}`
    }
  }
}

if (failedMessage !== null) {
  console.error(`PLAYLIST ENDPOINT CHECK FAILED: ${failedMessage}`)
  process.exit(1)
}

console.log(
  'PLAYLIST ENDPOINTS OK: create, list, add, update, and unfollow work.',
)
