import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  addUserTag,
  removeUserTag,
  type TagAddPayload,
  type TagKind,
  type TagRemovePayload,
} from '@/lib/tags'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readKind = (value: unknown): TagKind | null =>
  value === 'genre' || value === 'mood' ? value : null

const readUuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID_PATTERN.test(value) ? value : null

const readAddPayload = (value: unknown): TagAddPayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readKind(value.kind)
  const { name } = value
  if (songId === null || kind === null) return null
  if (typeof name !== 'string' || name.length === 0) return null
  return { songId, kind, name }
}

const readRemovePayload = (value: unknown): TagRemovePayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readKind(value.kind)
  const tagId = readUuid(value.tagId)
  if (songId === null || kind === null || tagId === null) return null
  return { songId, kind, tagId }
}

/**
 * Adds/removes one personal tag for the signed-in user. Not covered by
 * proxy.ts route protection, so it gates on getUser() itself; the user id
 * always comes from the session, and RLS enforces ownership on every write.
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

  const payload = readAddPayload(await readJson(request))
  if (payload === null) {
    return NextResponse.json(
      { status: 'error', message: 'Invalid request body' },
      { status: 400 },
    )
  }

  const result = await addUserTag(supabase, user.id, payload)
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}

export async function DELETE(request: Request) {
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

  const payload = readRemovePayload(await readJson(request))
  if (payload === null) {
    return NextResponse.json(
      { status: 'error', message: 'Invalid request body' },
      { status: 400 },
    )
  }

  const result = await removeUserTag(supabase, user.id, payload)
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
