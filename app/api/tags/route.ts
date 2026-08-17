import { errorResponse, jsonResult, requireUser } from '@/lib/api/route-helpers'
import { isRecord, readJson } from '@/lib/json'
import { readUuid } from '@/lib/playlists/validation'
import { createClient } from '@/lib/supabase/server'
import {
  addUserTag,
  hideAiTag,
  readTagKind,
  removeUserTag,
  showAiTag,
  type TagAddPayload,
  type TagHidePayload,
  type TagRemovePayload,
  type TagShowPayload,
} from '@/lib/tags'

const readAddPayload = (value: unknown): TagAddPayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readTagKind(value.kind)
  const { name } = value
  if (songId === null || kind === null) return null
  if (value.operation !== 'add') return null
  if (typeof name !== 'string' || name.length === 0) return null
  return { operation: 'add', songId, kind, name }
}

const readRemovePayload = (value: unknown): TagRemovePayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readTagKind(value.kind)
  const tagId = readUuid(value.tagId)
  if (songId === null || kind === null || tagId === null) return null
  if (value.operation !== 'remove') return null
  return { operation: 'remove', songId, kind, tagId }
}

const readHidePayload = (value: unknown): TagHidePayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readTagKind(value.kind)
  const tagId = readUuid(value.tagId)
  if (songId === null || kind === null || tagId === null) return null
  if (value.operation !== 'hide') return null
  return { operation: 'hide', songId, kind, tagId }
}

const readShowPayload = (value: unknown): TagShowPayload | null => {
  if (!isRecord(value)) return null
  const songId = readUuid(value.songId)
  const kind = readTagKind(value.kind)
  const tagId = readUuid(value.tagId)
  if (songId === null || kind === null || tagId === null) return null
  if (value.operation !== 'show') return null
  return { operation: 'show', songId, kind, tagId }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const body = await readJson(request)
  const addPayload = readAddPayload(body)
  if (addPayload !== null) {
    return jsonResult(await addUserTag(supabase, user.id, addPayload))
  }
  const hidePayload = readHidePayload(body)
  if (hidePayload !== null) {
    return jsonResult(await hideAiTag(supabase, user.id, hidePayload))
  }
  return errorResponse('Invalid request body', 400)
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const body = await readJson(request)
  const removePayload = readRemovePayload(body)
  if (removePayload !== null) {
    return jsonResult(await removeUserTag(supabase, user.id, removePayload))
  }
  const showPayload = readShowPayload(body)
  if (showPayload !== null) {
    return jsonResult(await showAiTag(supabase, user.id, showPayload))
  }
  return errorResponse('Invalid request body', 400)
}
