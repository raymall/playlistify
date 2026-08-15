import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import {
  type EnrichBatchPayload,
  enrichLibraryBatch,
} from '@/lib/enrichment/engine'
import { isRecord, readJson } from '@/lib/json'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 300

const readPayload = (value: unknown): EnrichBatchPayload | null => {
  if (!isRecord(value)) return null
  const { processedSoFar } = value
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
 * Claims and analyzes one batch of system-selected work from the signed-in
 * user's library. The body carries progress bookkeeping and nothing else — the
 * database picks the recipe, and with it the model, effort, and batch size, so
 * the browser has no model, provider, recipe, or rank authority at all.
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

  const result = await enrichLibraryBatch(user.id, payload.processedSoFar)
  const status =
    result.status !== 'error' ? 200 : result.safeToRetry === true ? 503 : 500
  return NextResponse.json(result, { status })
}
