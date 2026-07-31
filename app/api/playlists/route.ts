import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { isRecord, readJson, readString } from '@/lib/json'
import {
  createPlaylistForUser,
  type CreatePlaylistPayload,
} from '@/lib/playlists/create'
import { deletePlaylistForUser } from '@/lib/playlists/delete'
import {
  updatePlaylistDetails,
  type UpdatePlaylistDetailsPayload,
} from '@/lib/playlists/update'
import {
  PLAYLIST_DESCRIPTION_MAX,
  PLAYLIST_NAME_MAX,
  UUID_PATTERN,
} from '@/lib/playlists/validation'
import { createClient } from '@/lib/supabase/server'

const PROMPT_MAX = 500
const SONGS_MIN = 1
/**
 * No product cap on playlist size — this is only an abuse bound, matched to the
 * chat search ceiling (SCAN_CAP in lib/chat/tools.ts). Spotify itself allows
 * 10,000 tracks per playlist.
 */
const SONGS_MAX = 1000

const readSongIds = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  if (value.length < SONGS_MIN || value.length > SONGS_MAX) return null
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !UUID_PATTERN.test(entry)) return null
    if (seen.has(entry)) continue
    seen.add(entry)
    ids.push(entry)
  }
  return ids.length >= SONGS_MIN ? ids : null
}

const readUuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID_PATTERN.test(value) ? value : null

const readCreatePayload = (value: unknown): CreatePlaylistPayload | null => {
  if (!isRecord(value)) return null

  const rawName = readString(value.name)
  if (rawName === null) return null
  const name = rawName.trim()
  if (name.length === 0 || name.length > PLAYLIST_NAME_MAX) return null

  const rawDescription = readString(value.description) ?? ''
  const description = rawDescription.trim()
  if (description.length > PLAYLIST_DESCRIPTION_MAX) return null

  const songIds = readSongIds(value.songIds)
  if (songIds === null) return null

  // prompt is optional context; accept null or a capped string.
  const rawPrompt = value.prompt
  let prompt: string | null = null
  if (rawPrompt !== null && rawPrompt !== undefined) {
    const promptStr = readString(rawPrompt)
    if (promptStr === null) return null
    const trimmed = promptStr.trim()
    prompt = trimmed.length > 0 ? trimmed.slice(0, PROMPT_MAX) : null
  }

  return { name, description, songIds, prompt }
}

const readUpdatePayload = (
  value: unknown,
): UpdatePlaylistDetailsPayload | null => {
  if (!isRecord(value)) return null
  const playlistId = readUuid(value.playlistId)
  const rawName = readString(value.name)
  if (playlistId === null || rawName === null) return null
  const name = rawName.trim()
  const description = (readString(value.description) ?? '').trim()
  if (name.length === 0 || name.length > PLAYLIST_NAME_MAX) return null
  if (description.length > PLAYLIST_DESCRIPTION_MAX) return null
  return { playlistId, name, description }
}

const readPlaylistIdPayload = (
  value: unknown,
): { playlistId: string } | null => {
  if (!isRecord(value)) return null
  const playlistId = readUuid(value.playlistId)
  return playlistId === null ? null : { playlistId }
}

const playlistResponse = (result: { status: string }) =>
  NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })

const requirePlaylistUser = async () => {
  const supabase = await createClient()
  const auth = await requireUser(supabase)
  return { auth, supabase }
}

/**
 * Creates a Spotify playlist from a curated proposal for the signed-in user.
 * Not behind proxy.ts route protection, so it gates on getUser() itself; the
 * user id comes from the session and RLS scopes every read/write.
 *
 * CSRF posture: Supabase auth cookies are SameSite=Lax, acceptable for this
 * authenticated MVP endpoint.
 */
export async function POST(request: Request) {
  const { auth, supabase } = await requirePlaylistUser()
  if (auth.user === null) return auth.response

  const payload = readCreatePayload(await readJson(request))
  if (payload === null) return errorResponse('Invalid request body', 400)

  const result = await createPlaylistForUser(supabase, auth.user.id, payload)
  return playlistResponse(result)
}

export async function PATCH(request: Request) {
  const { auth, supabase } = await requirePlaylistUser()
  if (auth.user === null) return auth.response

  const payload = readUpdatePayload(await readJson(request))
  if (payload === null) return errorResponse('Invalid request body', 400)

  return playlistResponse(
    await updatePlaylistDetails(supabase, auth.user.id, payload),
  )
}

export async function DELETE(request: Request) {
  const { auth, supabase } = await requirePlaylistUser()
  if (auth.user === null) return auth.response

  const payload = readPlaylistIdPayload(await readJson(request))
  if (payload === null) return errorResponse('Invalid request body', 400)

  return playlistResponse(
    await deletePlaylistForUser(supabase, auth.user.id, payload.playlistId),
  )
}
