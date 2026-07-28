import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { isRecord, readJson } from '@/lib/json'
import { importLikedSongsBatch } from '@/lib/spotify/import'
import { createClient } from '@/lib/supabase/server'

const readOffset = (value: unknown): number | null => {
  if (!isRecord(value)) return null
  const { offset } = value
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    return null
  }
  return offset
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

  const offset = readOffset(await readJson(request))
  if (offset === null) return errorResponse('Invalid request body', 400)

  const result = await importLikedSongsBatch(user.id, offset)
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
