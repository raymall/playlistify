import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { isRecord, readJson } from '@/lib/json'
import { createClient } from '@/lib/supabase/server'
import {
  addUserTag,
  hideAiTag,
  removeUserTag,
  showAiTag,
  type TagAddPayload,
  type TagAddResponse,
  type TagHidePayload,
  type TagKind,
  type TagRemovePayload,
  type TagRemoveResponse,
  type TagShowPayload,
  type TagSuppressionResponse,
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
  if (value.operation !== 'add') return null
  if (typeof name !== 'string' || name.length === 0) return null
  return { operation: 'add', songId, kind, name }
}

const readRemovePayload = (value: unknown): TagRemovePayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readKind(value.kind)
  const tagId = readUuid(value.tagId)
  if (songId === null || kind === null || tagId === null) return null
  if (value.operation !== 'remove') return null
  return { operation: 'remove', songId, kind, tagId }
}

const readHidePayload = (value: unknown): TagHidePayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readKind(value.kind)
  const tagId = readUuid(value.tagId)
  if (songId === null || kind === null || tagId === null) return null
  if (value.operation !== 'hide') return null
  return { operation: 'hide', songId, kind, tagId }
}

const readShowPayload = (value: unknown): TagShowPayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readKind(value.kind)
  const tagId = readUuid(value.tagId)
  if (songId === null || kind === null || tagId === null) return null
  if (value.operation !== 'show') return null
  return { operation: 'show', songId, kind, tagId }
}

const requireTagUser = async () => {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  return { supabase, user, response }
}

const mutationResponse = (
  result: TagAddResponse | TagRemoveResponse | TagSuppressionResponse,
) =>
  NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })

export async function POST(request: Request) {
  const { supabase, user, response } = await requireTagUser()
  if (user === null) {
    return response ?? errorResponse('Authentication unavailable', 503, true)
  }
  const body = await readJson(request)
  const addPayload = readAddPayload(body)
  if (addPayload !== null) {
    return mutationResponse(await addUserTag(supabase, user.id, addPayload))
  }
  const hidePayload = readHidePayload(body)
  if (hidePayload !== null) {
    return mutationResponse(await hideAiTag(supabase, user.id, hidePayload))
  }
  return errorResponse('Invalid request body', 400)
}

export async function DELETE(request: Request) {
  const { supabase, user, response } = await requireTagUser()
  if (user === null) {
    return response ?? errorResponse('Authentication unavailable', 503, true)
  }
  const body = await readJson(request)
  const removePayload = readRemovePayload(body)
  if (removePayload !== null) {
    return mutationResponse(
      await removeUserTag(supabase, user.id, removePayload),
    )
  }
  const showPayload = readShowPayload(body)
  if (showPayload !== null) {
    return mutationResponse(await showAiTag(supabase, user.id, showPayload))
  }
  return errorResponse('Invalid request body', 400)
}
