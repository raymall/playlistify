import {
  errorResponse,
  jsonRetryableResult,
  requireUser,
} from '@/lib/api/route-helpers'
import { isRecord, readJson, readString } from '@/lib/json'
import { isTransientImportFailure } from '@/lib/spotify/import'
import { runLibrarySyncBatch } from '@/lib/spotify/sync'
import {
  isSyncStartCursor,
  readSyncCursor,
  type SyncCursor,
} from '@/lib/spotify/sync-contract'
import { createClient } from '@/lib/supabase/server'

type ImportPayload = {
  cursor: SyncCursor
  syncStartedAt: string | null
}

const readPayload = (value: unknown): ImportPayload | null => {
  if (!isRecord(value)) return null
  const cursor = readSyncCursor(value.cursor)
  if (cursor === null) return null
  if (isSyncStartCursor(cursor)) {
    return value.syncStartedAt === null || value.syncStartedAt === undefined
      ? { cursor, syncStartedAt: null }
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
  return { cursor, syncStartedAt }
}

/**
 * Runs one batch of the signed-in user's library sync from the echoed cursor
 * (Liked Songs, owned playlists, saved albums). Not covered by proxy.ts route
 * protection, so it gates on getUser() itself. The user id always comes from
 * the session — never the request body.
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
    return jsonRetryableResult(
      await runLibrarySyncBatch(user.id, payload.cursor, syncStartedAt),
    )
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
