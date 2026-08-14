import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import {
  type EnrichBatchPayload,
  enrichLibraryBatch,
  enrichSong,
  type EnrichSongPayload,
} from '@/lib/enrichment/engine'
import { isRecord, readJson } from '@/lib/json'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 300

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const readPayload = (
  value: unknown,
): EnrichBatchPayload | EnrichSongPayload | null => {
  if (!isRecord(value)) return null
  const { songId, processedSoFar } = value
  if (typeof songId === 'string') {
    return UUID_PATTERN.test(songId) ? { songId } : null
  }
  if (
    typeof processedSoFar !== 'number' ||
    !Number.isInteger(processedSoFar) ||
    processedSoFar < 0
  ) {
    return null
  }
  return { processedSoFar }
}

/**
 * Claims and analyzes guarded work from the signed-in user's library: one
 * batch by default, or one song when `songId` is given. Both go through the
 * same recipe selection, lease, and promotion — the browser supplies no model,
 * provider, recipe, or rank authority, only which of its own songs to run.
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

  const result =
    'songId' in payload
      ? await enrichSong(user.id, payload.songId)
      : await enrichLibraryBatch(user.id, payload.processedSoFar)
  const status =
    result.status !== 'error' ? 200 : result.safeToRetry === true ? 503 : 500
  return NextResponse.json(result, { status })
}
