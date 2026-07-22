import { NextResponse } from 'next/server'

import { findEnabledModel, getEnabledModels } from '@/lib/ai/models'
import { hasMappedProvider } from '@/lib/ai/providers'
import { enrichLibraryBatch } from '@/lib/enrichment/engine'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 300

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface ParsedPayload {
  modelId: string
  processedSoFar: number
}

const readPayload = (value: unknown): ParsedPayload | null => {
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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { status: 'error', message: 'Not signed in' },
      { status: 401 },
    )
  }

  const payload = readPayload(await readJson(request))
  if (payload === null) {
    return NextResponse.json(
      { status: 'error', message: 'Invalid request body' },
      { status: 400 },
    )
  }

  const models = await getEnabledModels(supabase)
  const model = findEnabledModel(models, payload.modelId)
  if (model === null) {
    return NextResponse.json(
      { status: 'error', message: 'Unknown or disabled model' },
      { status: 400 },
    )
  }
  if (!hasMappedProvider(model)) {
    return NextResponse.json(
      { status: 'error', message: 'Model provider not available' },
      { status: 400 },
    )
  }

  const result = await enrichLibraryBatch(
    user.id,
    model,
    payload.processedSoFar,
  )
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
