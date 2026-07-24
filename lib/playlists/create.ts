// Playlist creation engine — role-mirror of lib/spotify/import.ts. Owns the
// full create flow: ownership + track-id resolution (RLS client), Spotify
// playlist creation + chunked track adds, then best-effort persistence into
// `playlists`/`playlist_songs`. Failure policy: pre-Spotify failures leave
// nothing created (clean error/reconnect/rate-limited); an add-tracks failure
// mid-loop keeps the Spotify playlist and reports `partial` (never auto-delete
// user data); a DB persist failure after Spotify success reports `created`
// with persisted:false.

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  addPlaylistTracksChunk,
  createSpotifyPlaylist,
  fetchCurrentUserId,
  PLAYLIST_ADD_CHUNK_SIZE,
} from '@/lib/spotify/api'
import { getValidSpotifyToken } from '@/lib/spotify/token'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

/** Client → engine request. Order of `songIds` is the playlist order. */
export interface CreatePlaylistPayload {
  name: string
  description: string
  songIds: string[]
  prompt: string | null
}

/**
 * Engine → route/client response. HTTP 200 for every non-error status; the
 * client parses this one union.
 * - `created`: playlist made in Spotify with all tracks; `persisted` false
 *   when the DB rows failed (won't appear in /playlists).
 * - `partial`: playlist made but some tracks failed to add; kept in Spotify.
 * - `reconnect_required` / `rate_limited`: raised before anything was created.
 */
export type CreatePlaylistResponse =
  | {
      status: 'created'
      playlistId: string | null
      spotifyPlaylistId: string
      spotifyUrl: string
      persisted: boolean
    }
  | {
      status: 'partial'
      spotifyPlaylistId: string
      spotifyUrl: string
      addedCount: number
      requestedCount: number
      persisted: boolean
    }
  | { status: 'reconnect_required' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error'; message: string }

/** user_songs id-resolution page size — chunk `.in()` filters to stay safe. */
const OWNERSHIP_CHUNK_SIZE = 100

const spotifyPlaylistUrl = (id: string, url: string | null): string =>
  url ?? `https://open.spotify.com/playlist/${id}`

/**
 * Resolve every requested song id to its Spotify track id, scoped to the
 * requester's library by RLS. Any id that isn't owned (or doesn't exist) makes
 * the whole create fail — the model should only ever propose owned songs, so a
 * miss means a stale or forged id. Returns track ids in `songIds` order.
 */
const resolveTrackIds = async (
  supabase: SupabaseClient<Database>,
  songIds: string[],
): Promise<
  { status: 'ok'; trackIds: string[] } | { status: 'error'; message: string }
> => {
  const trackIdBySongId = new Map<string, string>()
  for (let i = 0; i < songIds.length; i += OWNERSHIP_CHUNK_SIZE) {
    const chunk = songIds.slice(i, i + OWNERSHIP_CHUNK_SIZE)
    const result = await supabase
      .from('user_songs')
      .select('song_id, songs!inner(id, spotify_track_id)')
      .in('song_id', chunk)
    if (result.error) {
      return { status: 'error', message: result.error.message }
    }
    for (const row of result.data) {
      trackIdBySongId.set(row.song_id, row.songs.spotify_track_id)
    }
  }

  const trackIds: string[] = []
  for (const songId of songIds) {
    const trackId = trackIdBySongId.get(songId)
    if (trackId === undefined) {
      return {
        status: 'error',
        message: 'One or more songs are no longer in your library.',
      }
    }
    trackIds.push(trackId)
  }
  return { status: 'ok', trackIds }
}

/**
 * Resolve the requester's Spotify user id: their own `profiles` row first,
 * falling back to `/me` (the column is nullable — captured only at the auth
 * callback) and backfilling it via the admin client for next time.
 */
const resolveSpotifyUserId = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  accessToken: string,
): Promise<
  { status: 'ok'; spotifyUserId: string } | CreatePlaylistResponse
> => {
  const profile = await supabase
    .from('profiles')
    .select('spotify_user_id')
    .eq('id', userId)
    .maybeSingle()
  if (profile.data?.spotify_user_id) {
    return { status: 'ok', spotifyUserId: profile.data.spotify_user_id }
  }

  const meResult = await fetchCurrentUserId(accessToken)
  if (meResult.status === 'auth_failed') return { status: 'reconnect_required' }
  if (meResult.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfterSeconds: meResult.retryAfterSeconds,
    }
  }
  if (meResult.status === 'error') {
    return { status: 'error', message: meResult.message }
  }

  // Backfill for next time — best-effort, never fails the request.
  const admin = createAdminClient()
  const update = await admin
    .from('profiles')
    .update({ spotify_user_id: meResult.data })
    .eq('id', userId)
  if (update.error) {
    console.error(
      '[playlists] spotify_user_id backfill failed:',
      update.error.message,
    )
  }
  return { status: 'ok', spotifyUserId: meResult.data }
}

export const createPlaylistForUser = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  payload: CreatePlaylistPayload,
): Promise<CreatePlaylistResponse> => {
  const resolved = await resolveTrackIds(supabase, payload.songIds)
  if (resolved.status === 'error') return resolved
  const { trackIds } = resolved

  const tokenResult = await getValidSpotifyToken(userId)
  if (tokenResult.status === 'reconnect_required') {
    return { status: 'reconnect_required' }
  }
  if (tokenResult.status === 'error') {
    return { status: 'error', message: tokenResult.message }
  }
  const { accessToken } = tokenResult

  const userIdResult = await resolveSpotifyUserId(supabase, userId, accessToken)
  if (userIdResult.status !== 'ok') return userIdResult
  const { spotifyUserId } = userIdResult

  const createResult = await createSpotifyPlaylist(accessToken, spotifyUserId, {
    name: payload.name,
    description: payload.description,
  })
  if (createResult.status === 'auth_failed') {
    return { status: 'reconnect_required' }
  }
  if (createResult.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfterSeconds: createResult.retryAfterSeconds,
    }
  }
  if (createResult.status === 'error') {
    return { status: 'error', message: createResult.message }
  }
  const playlist = createResult.data
  const spotifyUrl = spotifyPlaylistUrl(playlist.id, playlist.url)

  // Add tracks in playlist order. A chunk failure stops the loop and flips to
  // `partial` — the playlist stays in Spotify and we persist the prefix that
  // actually landed.
  let addedCount = 0
  let didAddFail = false
  for (let i = 0; i < trackIds.length; i += PLAYLIST_ADD_CHUNK_SIZE) {
    const chunk = trackIds.slice(i, i + PLAYLIST_ADD_CHUNK_SIZE)
    const addResult = await addPlaylistTracksChunk(
      accessToken,
      playlist.id,
      chunk,
    )
    if (addResult.status !== 'ok') {
      didAddFail = true
      break
    }
    addedCount += chunk.length
  }

  // Persist the playlist + its linked songs (RLS client — the user owns both
  // tables). Persistence failures never fail the request; they flip persisted.
  const linkedSongIds = payload.songIds.slice(0, addedCount)
  const persisted = await persistPlaylist(supabase, userId, {
    spotifyPlaylistId: playlist.id,
    name: payload.name,
    description: payload.description,
    prompt: payload.prompt,
    songIds: linkedSongIds,
  })

  if (didAddFail) {
    return {
      status: 'partial',
      spotifyPlaylistId: playlist.id,
      spotifyUrl,
      addedCount,
      requestedCount: trackIds.length,
      persisted: persisted.persisted,
    }
  }
  return {
    status: 'created',
    playlistId: persisted.playlistId,
    spotifyPlaylistId: playlist.id,
    spotifyUrl,
    persisted: persisted.persisted,
  }
}

interface PersistParams {
  spotifyPlaylistId: string
  name: string
  description: string
  prompt: string | null
  songIds: string[]
}

const persistPlaylist = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  params: PersistParams,
): Promise<{ playlistId: string | null; persisted: boolean }> => {
  const insertPlaylist = await supabase
    .from('playlists')
    .insert({
      user_id: userId,
      spotify_playlist_id: params.spotifyPlaylistId,
      name: params.name,
      description: params.description.length > 0 ? params.description : null,
      prompt: params.prompt,
    })
    .select('id')
    .single()
  if (insertPlaylist.error) {
    console.error(
      '[playlists] playlist insert failed:',
      insertPlaylist.error.message,
    )
    return { playlistId: null, persisted: false }
  }
  const playlistId = insertPlaylist.data.id

  if (params.songIds.length > 0) {
    const rows = params.songIds.map((songId, index) => ({
      playlist_id: playlistId,
      song_id: songId,
      position: index,
    }))
    const insertSongs = await supabase.from('playlist_songs').insert(rows)
    if (insertSongs.error) {
      console.error(
        '[playlists] playlist_songs insert failed:',
        insertSongs.error.message,
      )
      return { playlistId, persisted: false }
    }
  }
  return { playlistId, persisted: true }
}
