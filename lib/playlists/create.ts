// Playlist creation engine — role-mirror of lib/spotify/import.ts. Owns the
// full create flow: ownership + track-id resolution (RLS client), shared
// Spotify build, then best-effort persistence into
// `playlists`/`playlist_songs`. Failure policy: pre-Spotify failures leave
// nothing created (clean error/reconnect/rate-limited); a partial add keeps the
// playlist and reports `partial` (never discards tracks the user got); adding
// ZERO tracks removes the empty shell this call just created and reports the
// real error; a DB persist failure after Spotify success reports `created`
// with persisted:false.

import type { SupabaseClient } from '@supabase/supabase-js'

import { buildSpotifyPlaylist } from '@/lib/playlists/build'
import { mapTokenFailure } from '@/lib/playlists/spotify-failures'
import { resolveTrackIds } from '@/lib/playlists/tracks'
import { getValidSpotifyToken } from '@/lib/spotify/token'
import type { Database } from '@/lib/supabase/types'

/** Client → engine request. Order of `songIds` is the playlist order. */
export type CreatePlaylistPayload = {
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

export const createPlaylistForUser = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  payload: CreatePlaylistPayload,
): Promise<CreatePlaylistResponse> => {
  const resolved = await resolveTrackIds(supabase, payload.songIds, 'fail')
  if (resolved.status === 'error') return resolved
  const { trackIds } = resolved

  const tokenResult = await getValidSpotifyToken(userId)
  if (tokenResult.status !== 'ok') return mapTokenFailure(tokenResult)
  const { accessToken } = tokenResult

  const buildResult = await buildSpotifyPlaylist(accessToken, {
    name: payload.name,
    description: payload.description,
    trackIds,
  })
  if (buildResult.status !== 'built') return buildResult
  const { addedCount, spotifyPlaylistId, spotifyUrl } = buildResult

  // Persist the playlist + its linked songs (RLS client — the user owns both
  // tables). Persistence failures never fail the request; they flip persisted.
  const linkedSongIds = payload.songIds.slice(0, addedCount)
  const persisted = await persistPlaylist(supabase, userId, {
    spotifyPlaylistId,
    name: payload.name,
    description: payload.description,
    prompt: payload.prompt,
    songIds: linkedSongIds,
  })

  if (addedCount < trackIds.length) {
    return {
      status: 'partial',
      spotifyPlaylistId,
      spotifyUrl,
      addedCount,
      requestedCount: trackIds.length,
      persisted: persisted.persisted,
    }
  }
  return {
    status: 'created',
    playlistId: persisted.playlistId,
    spotifyPlaylistId,
    spotifyUrl,
    persisted: persisted.persisted,
  }
}

type PersistParams = {
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
