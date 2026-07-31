import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { isRecord, readJson } from '@/lib/json'
import { recreatePlaylistForUser } from '@/lib/playlists/recreate'
import { UUID_PATTERN } from '@/lib/playlists/validation'
import { createClient } from '@/lib/supabase/server'

const readPayload = (value: unknown): { playlistId: string } | null => {
  if (!isRecord(value)) return null
  const { playlistId } = value
  return typeof playlistId === 'string' && UUID_PATTERN.test(playlistId)
    ? { playlistId }
    : null
}

/** Rebuild a missing Spotify playlist from its stored ordered song snapshot. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const payload = readPayload(await readJson(request))
  if (payload === null) return errorResponse('Invalid request body', 400)

  const result = await recreatePlaylistForUser(
    supabase,
    user.id,
    payload.playlistId,
  )
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
