import type { SupabaseClient, User } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { classifyNullUser } from '@/lib/supabase/auth'

/**
 * Standard error body for the JSON API routes. Server-only (imports
 * next/server) — never import from a client component. `safeToRetry` is
 * omitted entirely when unset: the enrichment client treats an absent field
 * as ambiguous and an explicit `false` as a billed failure, so always
 * spreading it would change client behavior.
 */
export const errorResponse = (
  message: string,
  status: number,
  safeToRetry?: boolean,
) =>
  NextResponse.json(
    safeToRetry === undefined
      ? { status: 'error', message }
      : { status: 'error', message, safeToRetry },
    { status },
  )

/**
 * The auth gate every `/api/*` handler uses — `/api` is not covered by
 * proxy.ts route protection, so each one gates on `getUser()` itself.
 *
 * A failure that is not provably a dead session (`classifyNullUser`) becomes a
 * 503 the client may retry for free, rather than a logout the user never
 * performed. A real signed-out request is still a 401.
 *
 * Shared rather than per-route so the distinction can't be forgotten by the
 * next handler: returning a bare 401 on a null user is the bug this prevents.
 */
export const requireUser = async (
  supabase: SupabaseClient,
): Promise<
  { user: User; response: null } | { user: null; response: NextResponse }
> => {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (user !== null) return { user, response: null }
  return {
    user: null,
    response: classifyNullUser('requireUser', error)
      ? errorResponse('Not signed in', 401)
      : errorResponse('Could not reach the auth service', 503, true),
  }
}
