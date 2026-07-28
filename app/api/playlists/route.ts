import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { isRecord, readJson, readString } from '@/lib/json'
import {
  createPlaylistForUser,
  type CreatePlaylistPayload,
} from '@/lib/playlists/create'
import { createClient } from '@/lib/supabase/server'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NAME_MAX = 100
const DESCRIPTION_MAX = 300
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

const readPayload = (value: unknown): CreatePlaylistPayload | null => {
  if (!isRecord(value)) return null

  const rawName = readString(value.name)
  if (rawName === null) return null
  const name = rawName.trim()
  if (name.length === 0 || name.length > NAME_MAX) return null

  const rawDescription = readString(value.description) ?? ''
  const description = rawDescription.trim()
  if (description.length > DESCRIPTION_MAX) return null

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

/**
 * Creates a Spotify playlist from a curated proposal for the signed-in user.
 * Not behind proxy.ts route protection, so it gates on getUser() itself; the
 * user id comes from the session and RLS scopes every read/write.
 *
 * CSRF posture: Supabase auth cookies are SameSite=Lax, acceptable for this
 * authenticated MVP endpoint.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const payload = readPayload(await readJson(request))
  if (payload === null) return errorResponse('Invalid request body', 400)

  const result = await createPlaylistForUser(supabase, user.id, payload)
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
