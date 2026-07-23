import {
  type AuthError,
  isAuthApiError,
  isAuthSessionMissingError,
} from '@supabase/supabase-js'
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

/**
 * Only a provably absent or rejected session is "signed out": no error at
 * all, no session, or the auth server itself refusing the token. Everything
 * else (socket failures, rate limits, HTML from a broken proxy) is the auth
 * service misbehaving — not the user's session dying.
 */
const INVALID_SESSION_STATUSES = [400, 401, 403]
const isSessionDead = (error: AuthError | null) =>
  error === null ||
  isAuthSessionMissingError(error) ||
  (isAuthApiError(error) && INVALID_SESSION_STATUSES.includes(error.status))

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
    error: authError,
  } = await supabase.auth.getUser()
  if (!user) {
    // A network-level or auth-service getUser() failure is not a signed-out
    // user — report it as transient (and billing-free) so the client retries
    // instead of claiming the session expired.
    if (!isSessionDead(authError)) {
      return NextResponse.json(
        {
          status: 'error',
          message: 'Could not reach the auth service',
          safeToRetry: true,
        },
        { status: 503 },
      )
    }
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
  if (models === null) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Could not load the model catalog',
        safeToRetry: true,
      },
      { status: 503 },
    )
  }
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
  const status =
    result.status !== 'error' ? 200 : result.safeToRetry === true ? 503 : 500
  return NextResponse.json(result, { status })
}
