import { NextResponse } from 'next/server'

import { findEnabledModel, getEnabledModels } from '@/lib/ai/models'
import { hasMappedProvider } from '@/lib/ai/providers'
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
  const { modelId, processedSoFar } = value
  if (typeof modelId !== 'string' || modelId.length === 0) return null
  if (
    typeof processedSoFar !== 'number' ||
    !Number.isInteger(processedSoFar) ||
    processedSoFar < 0
  ) {
    return null
  }
  return { modelId, processedSoFar }
}

/**
 * Enriches one batch of the signed-in user's pending songs. Not covered by
 * proxy.ts route protection, so it gates on getUser() itself. The user id
 * always comes from the session, and the billable model is resolved from the
 * llm_models catalog server-side — the client only ever names a row id.
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

  const models = await getEnabledModels(supabase)
  if (models === null) {
    return errorResponse('Could not load the model catalog', 503, true)
  }
  const model = findEnabledModel(models, payload.modelId)
  if (model === null) return errorResponse('Unknown or disabled model', 400)
  if (!hasMappedProvider(model)) {
    return errorResponse('Model provider not available', 400)
  }

  const result = await enrichLibraryBatch(
    user.id,
    model,
    payload.processedSoFar,
  )
  const status =
    result.status !== 'error' ? 200 : result.safeToRetry === true ? 503 : 500
  return NextResponse.json(result, { status })
}
