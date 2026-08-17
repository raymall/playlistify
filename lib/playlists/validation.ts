import { isRecord } from '@/lib/json'

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const PLAYLIST_NAME_MAX = 100
export const PLAYLIST_DESCRIPTION_MAX = 300

export const readUuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID_PATTERN.test(value) ? value : null

/** Narrow a JSON body to `{ playlistId }`, or null when it isn't one. */
export const readPlaylistIdPayload = (
  value: unknown,
): { playlistId: string } | null => {
  if (!isRecord(value)) return null
  const playlistId = readUuid(value.playlistId)
  return playlistId === null ? null : { playlistId }
}
