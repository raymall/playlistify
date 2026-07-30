import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { isRecord, readJson, readString } from '@/lib/json'
import {
  importLikedSongsBatch,
  isTransientImportFailure,
} from '@/lib/spotify/import'
import { createClient } from '@/lib/supabase/server'

type ImportPayload = {
  offset: number
  syncStartedAt: string | null
}

const readPayload = (value: unknown): ImportPayload | null => {
  if (!isRecord(value)) return null
  const { offset } = value
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    return null
  }
  if (offset === 0) {
    return value.syncStartedAt === null || value.syncStartedAt === undefined
      ? { offset, syncStartedAt: null }
      : null
  }
  const syncStartedAt = readString(value.syncStartedAt)
  if (
    syncStartedAt === null ||
    !Number.isFinite(Date.parse(syncStartedAt)) ||
    Date.parse(syncStartedAt) > Date.now() + 60_000
  ) {
    return null
  }
  return { offset, syncStartedAt }
}

/**
 * Imports one batch of Liked Songs for the signed-in user. Not covered by
 * proxy.ts route protection, so it gates on getUser() itself. The user id
 * always comes from the session — never the request body.
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
  const syncStartedAt = payload.syncStartedAt ?? new Date().toISOString()

  try {
    const result = await importLikedSongsBatch(
      user.id,
      payload.offset,
      syncStartedAt,
    )
    const status =
      result.status !== 'error' ? 200 : result.safeToRetry === true ? 503 : 500
    return NextResponse.json(result, { status })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected import failure'
    if (isTransientImportFailure(message)) {
      return errorResponse(
        'The import service connection was interrupted.',
        503,
        true,
      )
    }
    console.error('[import] unexpected failure:', error)
    return errorResponse('The import failed unexpectedly', 500)
  }
}
