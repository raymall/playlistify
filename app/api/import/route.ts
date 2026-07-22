import { NextResponse } from 'next/server'

import { importLikedSongsBatch } from '@/lib/spotify/import'
import { createClient } from '@/lib/supabase/server'

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { status: 'error', message: 'Not signed in' },
      { status: 401 },
    )
  }

  const offset = readOffset(await readJson(request))
  if (offset === null) {
    return NextResponse.json(
      { status: 'error', message: 'Invalid request body' },
      { status: 400 },
    )
  }

  const result = await importLikedSongsBatch(user.id, offset)
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
