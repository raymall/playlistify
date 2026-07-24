import { NextResponse } from 'next/server'

import { errorResponse } from '@/lib/api/route-helpers'
import { isRecord, readJson } from '@/lib/json'
import { createClient } from '@/lib/supabase/server'
import {
  addUserTag,
  removeUserTag,
  type TagAddPayload,
  type TagAddResponse,
  type TagKind,
  type TagRemovePayload,
  type TagRemoveResponse,
} from '@/lib/tags'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Adds/removes one personal tag for the signed-in user. Not covered by
 * proxy.ts route protection, so it gates on getUser() itself; the user id
 * always comes from the session, and RLS enforces ownership on every write.
 *
 * CSRF posture: Supabase auth cookies are SameSite=Lax, acceptable for this
 * authenticated MVP endpoint.
 */
const handleTagMutation = async <Payload>(
  request: Request,
  parsePayload: (value: unknown) => Payload | null,
  run: (
    supabase: ServerClient,
    userId: string,
    payload: Payload,
  ) => Promise<TagAddResponse | TagRemoveResponse>,
) => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return errorResponse('Not signed in', 401)

  const payload = parsePayload(await readJson(request))
  if (payload === null) return errorResponse('Invalid request body', 400)

  const result = await run(supabase, user.id, payload)
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}

export async function POST(request: Request) {
  return handleTagMutation(request, readAddPayload, addUserTag)
}

export async function DELETE(request: Request) {
  return handleTagMutation(request, readRemovePayload, removeUserTag)
}
