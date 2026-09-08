/**
 * Client-safe contract for the whole-library sync loop: the cursor the client
 * echoes back to `POST /api/import`, the batch response it folds into its
 * state machine, and the parsers both sides use. Pure TypeScript — no server,
 * React, or browser dependency.
 */
import { isRecord, readNumber, readString } from '@/lib/json'

export type SyncPhase = 'liked' | 'playlists' | 'albums'

export const SYNC_PHASES: readonly SyncPhase[] = [
  'liked',
  'playlists',
  'albums',
]

/**
 * Where the next batch resumes. The server issues it, the client echoes it,
 * the server re-validates it — no sync state lives in the database.
 *
 * - `liked`: Saved Tracks offset.
 * - `playlists`: `playlists` is the owned-playlist snapshot taken on the
 *   phase's first batch (`null` = not taken yet); `index` is the playlist
 *   being read and `itemOffset` the item offset inside it.
 * - `albums`: Saved Albums offset.
 */
export type SyncCursor =
  | { phase: 'liked'; offset: number }
  | {
      phase: 'playlists'
      playlists: string[] | null
      index: number
      itemOffset: number
    }
  | { phase: 'albums'; offset: number }

export const SYNC_START_CURSOR: SyncCursor = { phase: 'liked', offset: 0 }

/** The stateless cursor carries every owned playlist id; this bounds it. */
export const SYNC_MAX_PLAYLISTS = 2000

const PLAYLIST_ID_PATTERN = /^[0-9A-Za-z]{10,40}$/

export type SyncBatchResponse =
  | {
      status: 'progress'
      syncStartedAt: string
      next: SyncCursor
      /** The phase `next` continues, and how far along it is. */
      phase: SyncPhase
      phaseCurrent: number
      phaseTotal: number | null
      batchImported: number
    }
  | {
      status: 'done'
      /** Library size after the completed pass. */
      total: number
      importedCount: number
      removedCount: number
    }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'reconnect_required' }
  | { status: 'error'; message: string; safeToRetry?: boolean }

export const isSyncStartCursor = (cursor: SyncCursor) =>
  cursor.phase === 'liked' && cursor.offset === 0

const readIndex = (value: unknown): number | null => {
  const number = readNumber(value)
  return number !== null && Number.isInteger(number) && number >= 0
    ? number
    : null
}

/** Parse a cursor from untrusted JSON, or null when it is malformed. */
export const readSyncCursor = (value: unknown): SyncCursor | null => {
  if (!isRecord(value)) return null
  const { phase } = value
  if (phase === 'liked' || phase === 'albums') {
    const offset = readIndex(value.offset)
    return offset === null ? null : { phase, offset }
  }
  if (phase !== 'playlists') return null
  const index = readIndex(value.index)
  const itemOffset = readIndex(value.itemOffset)
  if (index === null || itemOffset === null) return null
  if (value.playlists === null) {
    return index === 0 && itemOffset === 0
      ? { phase, playlists: null, index, itemOffset }
      : null
  }
  if (
    !Array.isArray(value.playlists) ||
    value.playlists.length > SYNC_MAX_PLAYLISTS ||
    index > value.playlists.length
  ) {
    return null
  }
  const playlists: string[] = []
  for (const entry of value.playlists) {
    const id = readString(entry)
    if (id === null || !PLAYLIST_ID_PATTERN.test(id)) return null
    playlists.push(id)
  }
  return { phase, playlists, index, itemOffset }
}

const readPhase = (value: unknown): SyncPhase | null =>
  value === 'liked' || value === 'playlists' || value === 'albums'
    ? value
    : null

/** Parse the route's JSON body into the response contract, or null if malformed. */
export const parseSyncBatchResponse = (
  value: unknown,
): SyncBatchResponse | null => {
  if (!isRecord(value)) return null
  const { status } = value
  if (status === 'progress') {
    const syncStartedAt = readString(value.syncStartedAt)
    const next = readSyncCursor(value.next)
    const phase = readPhase(value.phase)
    const phaseCurrent = readNumber(value.phaseCurrent)
    const rawPhaseTotal = value.phaseTotal
    const phaseTotal = rawPhaseTotal === null ? null : readNumber(rawPhaseTotal)
    const batchImported = readNumber(value.batchImported)
    if (
      syncStartedAt === null ||
      next === null ||
      phase === null ||
      phaseCurrent === null ||
      (rawPhaseTotal !== null && phaseTotal === null) ||
      batchImported === null
    ) {
      return null
    }
    return {
      status,
      syncStartedAt,
      next,
      phase,
      phaseCurrent,
      phaseTotal,
      batchImported,
    }
  }
  if (status === 'done') {
    const total = readNumber(value.total)
    const importedCount = readNumber(value.importedCount)
    const removedCount = readNumber(value.removedCount)
    if (total === null || importedCount === null || removedCount === null) {
      return null
    }
    return { status, total, importedCount, removedCount }
  }
  if (status === 'rate_limited') {
    const retryAfterSeconds = readNumber(value.retryAfterSeconds)
    if (retryAfterSeconds === null) return null
    return { status, retryAfterSeconds }
  }
  if (status === 'reconnect_required') return { status }
  if (status === 'error') {
    return {
      status,
      message: readString(value.message) ?? 'Something went wrong.',
      safeToRetry: value.safeToRetry === true,
    }
  }
  return null
}
