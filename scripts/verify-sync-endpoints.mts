// Live Spotify whole-library sync endpoint verification: proves the read
// endpoints the multi-source sync depends on work for THIS app before anything
// is built on them — `GET /playlists/{id}/items`, `GET /me/albums`, and
// `GET /albums/{id}/tracks` — plus the `owner.id` / `snapshot_id` / item-count
// fields on `GET /me/playlists`. Creates a private throwaway playlist holding
// one saved track so the playlist-items read has something deterministic to
// assert against; cleanup runs even when an assertion fails. The batch
// `GET /tracks?ids=` probe is informational only.
//
// A 403 from `/playlists/{id}/items` or `/me/albums` is a hard stop: this
// app's endpoint history says a retired path 403s exactly like a scope error,
// so nothing should be built past a failed probe.
//
// Usage: node --env-file=.env.local --import tsx scripts/verify-sync-endpoints.mts
import { createClient } from '@supabase/supabase-js'

import {
  addPlaylistTracksChunk,
  createSpotifyPlaylist,
  deleteSpotifyPlaylist,
  fetchAlbumTracksPage,
  fetchPlaylistItemsPage,
  fetchSavedAlbumsPage,
  fetchUserPlaylists,
  type SpotifyPlaylistMetadata,
} from '../lib/spotify/api'
import { getValidSpotifyToken } from '../lib/spotify/token'
import type { Database } from '../lib/supabase/types'
import { requireEnv } from './lib/env.mjs'
import { createChecker } from './lib/verify.mjs'

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

const READ_RETRIES = 15
const READ_RETRY_DELAY_MS = 1_000
/** Syntactically valid playlist id that no playlist carries. */
const MISSING_PLAYLIST_ID = '0000000000000000000000'

const service = createClient<Database>(url, serviceKey)
const { hard, hasFailed } = createChecker()

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const tokenRow = await service
  .from('spotify_tokens')
  .select('user_id')
  .limit(1)
  .maybeSingle()
if (tokenRow.error || tokenRow.data === null) {
  console.error('No Spotify token row — sign in and reconnect Spotify first.')
  process.exit(1)
}
const { user_id: userId } = tokenRow.data

const tokenResult = await getValidSpotifyToken(userId)
if (tokenResult.status !== 'ok') {
  console.error('Could not obtain a Spotify access token:', tokenResult.status)
  process.exit(1)
}
const { accessToken } = tokenResult

const profileRow = await service
  .from('profiles')
  .select('spotify_user_id')
  .eq('id', userId)
  .maybeSingle()
const spotifyUserId = profileRow.data?.spotify_user_id ?? null
hard(
  'profiles.spotify_user_id is set for the token user',
  spotifyUserId !== null,
)
if (spotifyUserId === null) process.exit(1)

const songResult = await service
  .from('user_songs')
  .select('songs!inner(spotify_track_id)')
  .eq('user_id', userId)
  .limit(1)
  .maybeSingle()
if (songResult.error || songResult.data === null) {
  console.error('No saved song is available for the playlist read test.')
  process.exit(1)
}
const trackId = songResult.data.songs.spotify_track_id

const waitForPlaylist = async (
  playlistId: string,
  predicate: (playlist: SpotifyPlaylistMetadata | undefined) => boolean,
): Promise<Map<string, SpotifyPlaylistMetadata> | null> => {
  for (let attempt = 0; attempt < READ_RETRIES; attempt += 1) {
    const listResult = await fetchUserPlaylists(accessToken)
    if (listResult.status !== 'ok') {
      throw new Error(
        `Playlist listing failed: ${listResult.status}${
          listResult.status === 'error' ? ` (${listResult.message})` : ''
        }`,
      )
    }
    if (predicate(listResult.data.get(playlistId))) return listResult.data
    await sleep(READ_RETRY_DELAY_MS)
  }
  return null
}

let playlistId: string | null = null
let failedMessage: string | null = null

try {
  // ── GET /me/playlists: owner.id, snapshot_id, item count ────────────────
  const createResult = await createSpotifyPlaylist(accessToken, {
    name: `Playlistify sync probe ${new Date().toISOString()}`,
    description: '',
  })
  if (createResult.status !== 'ok') {
    throw new Error(`Playlist creation failed: ${createResult.status}`)
  }
  playlistId = createResult.data.id

  const addResult = await addPlaylistTracksChunk(accessToken, playlistId, [
    trackId,
  ])
  if (addResult.status !== 'ok') {
    throw new Error(`Adding a playlist item failed: ${addResult.status}`)
  }

  const listing = await waitForPlaylist(
    playlistId,
    (playlist) => playlist !== undefined,
  )
  const listed = listing?.get(playlistId)
  hard(
    'GET /me/playlists lists the throwaway playlist',
    listed !== undefined,
    listed === undefined ? 'not listed in time' : undefined,
  )
  if (listing !== null && listed !== undefined) {
    hard(
      'GET /me/playlists owner.id matches profiles.spotify_user_id',
      listed.ownerId === spotifyUserId,
      listed.ownerId === null ? 'owner.id missing' : undefined,
    )
    hard('GET /me/playlists carries snapshot_id', listed.snapshotId !== null)
    // The listing's item count lags the add by more than the retry window,
    // so only its presence is asserted; the sync pages by the items endpoint.
    hard(
      'GET /me/playlists carries an item count',
      listed.trackTotal !== null,
      `trackTotal=${listed.trackTotal ?? 'null'}`,
    )
    const all = [...listing.values()]
    const ownerless = all.filter((playlist) => playlist.ownerId === null)
    const owned = all.filter((playlist) => playlist.ownerId === spotifyUserId)
    hard(
      'every listed playlist carries owner.id',
      ownerless.length === 0,
      `missing=${ownerless.length}`,
    )
    console.log(
      `INFO  playlists listed=${all.length} owned=${owned.length} followed=${all.length - owned.length}`,
    )
  }

  // ── GET /playlists/{id}/items ──────────────────────────────────────────
  let itemsRead = null
  for (let attempt = 0; attempt < READ_RETRIES; attempt += 1) {
    const itemsResult = await fetchPlaylistItemsPage(accessToken, playlistId, 0)
    if (itemsResult.status === 'auth_failed') {
      hard(
        'GET /playlists/{id}/items is readable (403 = HARD STOP)',
        false,
        'auth_failed — see the [spotify] log line above for the body',
      )
      throw new Error('GET /playlists/{id}/items is forbidden for this app')
    }
    if (itemsResult.status !== 'ok') {
      throw new Error(`Playlist items read failed: ${itemsResult.status}`)
    }
    if (itemsResult.data.items.length === 1) {
      itemsRead = itemsResult.data
      break
    }
    await sleep(READ_RETRY_DELAY_MS)
  }
  hard(
    'GET /playlists/{id}/items returns the one added item',
    itemsRead !== null,
    itemsRead === null ? 'item did not appear in time' : undefined,
  )
  if (itemsRead !== null) {
    const [item] = itemsRead.items
    hard(
      'playlist item parses to the added track',
      item.track?.id === trackId,
      item.track === null ? 'track parsed as null' : undefined,
    )
    hard('playlist item carries added_at', item.added_at !== null)
    hard('playlist items page reports total = 1', itemsRead.total === 1)
  }

  const missingResult = await fetchPlaylistItemsPage(
    accessToken,
    MISSING_PLAYLIST_ID,
    0,
  )
  console.log(
    `INFO  GET /playlists/{missing}/items → ${missingResult.status}${
      missingResult.status === 'error' ? ` (${missingResult.message})` : ''
    }`,
  )

  // ── GET /me/albums (+ /albums/{id}/tracks) ─────────────────────────────
  const albumsResult = await fetchSavedAlbumsPage(accessToken, 0)
  if (albumsResult.status === 'auth_failed') {
    hard(
      'GET /me/albums is readable (403 = HARD STOP)',
      false,
      'auth_failed — see the [spotify] log line above for the body',
    )
    throw new Error('GET /me/albums is forbidden for this app')
  }
  if (albumsResult.status !== 'ok') {
    throw new Error(`Saved albums read failed: ${albumsResult.status}`)
  }
  hard('GET /me/albums is readable', true)
  const albumsPage = albumsResult.data
  console.log(
    `INFO  saved albums total=${albumsPage.total} firstPage=${albumsPage.items.length}`,
  )

  if (albumsPage.total === 0) {
    console.log(
      'INFO  no saved albums — album parsing and /albums/{id}/tracks not exercised',
    )
  } else {
    const first = albumsPage.items.find((entry) => entry.album !== null)
    hard(
      'first saved album parses (id + embedded tracks)',
      first?.album !== undefined &&
        first.album !== null &&
        first.album.tracks.length > 0,
    )
    if (first?.album) {
      const { album } = first
      hard('saved album carries added_at', first.added_at !== null)
      hard(
        'embedded album tracks carry the parent album name',
        album.tracks.every((track) => track.album.name === album.album.name),
      )
      hard(
        'embedded album tracks carry popularity = null',
        album.tracks.every((track) => track.popularity === null),
      )
      hard(
        'album trackTotal >= embedded count',
        album.trackTotal >= album.embeddedTrackCount,
        `total=${album.trackTotal} embedded=${album.embeddedTrackCount}`,
      )

      const tracksResult = await fetchAlbumTracksPage(
        accessToken,
        album.id,
        0,
        album.album,
      )
      hard(
        'GET /albums/{id}/tracks is readable',
        tracksResult.status === 'ok' && tracksResult.data.items.length > 0,
        tracksResult.status === 'ok'
          ? `items=${tracksResult.data.items.length}`
          : tracksResult.status,
      )
    }

    const large = albumsPage.items.find(
      (entry) =>
        entry.album !== null &&
        entry.album.trackTotal > entry.album.embeddedTrackCount,
    )
    if (large?.album) {
      const { album } = large
      const continuation = await fetchAlbumTracksPage(
        accessToken,
        album.id,
        album.embeddedTrackCount,
        album.album,
      )
      hard(
        'GET /albums/{id}/tracks continuation page returns the remaining tracks',
        continuation.status === 'ok' &&
          continuation.data.items.length ===
            Math.min(50, album.trackTotal - album.embeddedTrackCount),
        continuation.status === 'ok'
          ? `offset=${album.embeddedTrackCount} items=${continuation.data.items.length} total=${continuation.data.total}`
          : continuation.status,
      )
    } else {
      console.log(
        'INFO  no saved album on the first page exceeds its embedded track page — continuation not exercised',
      )
    }
  }

  // ── Informational: batch GET /tracks?ids= ──────────────────────────────
  const batchResponse = await fetch(
    `https://api.spotify.com/v1/tracks?ids=${encodeURIComponent(trackId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  console.log(`INFO  batch GET /tracks?ids= → HTTP ${batchResponse.status}`)
} catch (error) {
  failedMessage = error instanceof Error ? error.message : 'Unknown failure'
} finally {
  if (playlistId !== null) {
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
  console.error(`\nSYNC ENDPOINT CHECK FAILED: ${failedMessage}`)
  process.exit(1)
}

console.log(
  hasFailed()
    ? '\nSYNC ENDPOINT CHECK FAILED: see FAIL lines above.'
    : '\nSYNC ENDPOINTS OK: playlist items, saved albums, and album tracks read for this app.',
)
process.exit(hasFailed() ? 1 : 0)
