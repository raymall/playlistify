// Client-safe playlist-management response parsers. Response types are
// imported type-only so client components never pull server engines into their
// bundle.

import { isRecord, readNumber, readString } from '@/lib/json'
import type { DeletePlaylistResponse } from '@/lib/playlists/delete'
import type { RecreatePlaylistResponse } from '@/lib/playlists/recreate'
import type { SyncPlaylistStatusesResponse } from '@/lib/playlists/sync'
import type { UpdatePlaylistDetailsResponse } from '@/lib/playlists/update'

type PlaylistFailureResponse =
  | { status: 'reconnect_required' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error'; message: string }

/**
 * Shared failure tail of every playlist-mutation response. Also reused by the
 * chat create-playlist parser (lib/chat/contract.ts), whose failure arms are
 * structurally identical.
 */
export const readPlaylistFailureResponse = (
  value: Record<string, unknown>,
): PlaylistFailureResponse | null => {
  const { status } = value
  if (status === 'reconnect_required') return { status }
  if (status === 'rate_limited') {
    const retryAfterSeconds = readNumber(value.retryAfterSeconds)
    return retryAfterSeconds === null ? null : { status, retryAfterSeconds }
  }
  if (status === 'error') {
    return {
      status,
      message: readString(value.message) ?? 'Something went wrong.',
    }
  }
  return null
}

export const readSyncPlaylistStatusesResponse = (
  value: unknown,
): SyncPlaylistStatusesResponse | null => {
  if (!isRecord(value)) return null
  if (value.status === 'ok') {
    const presentCount = readNumber(value.presentCount)
    const missingCount = readNumber(value.missingCount)
    if (presentCount === null || missingCount === null) return null
    return { status: 'ok', presentCount, missingCount }
  }
  return readPlaylistFailureResponse(value)
}

export const readUpdatePlaylistDetailsResponse = (
  value: unknown,
): UpdatePlaylistDetailsResponse | null => {
  if (!isRecord(value)) return null
  if (value.status === 'updated') {
    if (typeof value.didUpdateSpotify !== 'boolean') return null
    return { status: 'updated', didUpdateSpotify: value.didUpdateSpotify }
  }
  return readPlaylistFailureResponse(value)
}

export const readDeletePlaylistResponse = (
  value: unknown,
): DeletePlaylistResponse | null => {
  if (!isRecord(value)) return null
  if (value.status === 'deleted') {
    if (typeof value.didDeleteSpotify !== 'boolean') return null
    return { status: 'deleted', didDeleteSpotify: value.didDeleteSpotify }
  }
  return readPlaylistFailureResponse(value)
}

export const readRecreatePlaylistResponse = (
  value: unknown,
): RecreatePlaylistResponse | null => {
  if (!isRecord(value)) return null
  if (value.status === 'recreated') {
    const spotifyPlaylistId = readString(value.spotifyPlaylistId)
    const spotifyUrl = readString(value.spotifyUrl)
    const addedCount = readNumber(value.addedCount)
    const requestedCount = readNumber(value.requestedCount)
    if (
      spotifyPlaylistId === null ||
      spotifyUrl === null ||
      addedCount === null ||
      requestedCount === null
    ) {
      return null
    }
    return {
      status: 'recreated',
      spotifyPlaylistId,
      spotifyUrl,
      addedCount,
      requestedCount,
    }
  }
  return readPlaylistFailureResponse(value)
}
