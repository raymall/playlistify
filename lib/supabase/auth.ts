import {
  type AuthError,
  isAuthApiError,
  isAuthSessionMissingError,
} from '@supabase/supabase-js'

/**
 * Supabase rotates the session token, and under concurrent requests
 * `getUser()` transiently returns a null user on a perfectly live session.
 * Every hard auth gate therefore has to tell "signed out" apart from "the auth
 * service just blinked", or it reports a spurious logout mid-action.
 *
 * Only a provably absent or rejected session is "signed out": no error at all,
 * no session, or the auth server itself refusing the token. Everything else
 * (socket failures, rate limits, HTML from a broken proxy) is the auth service
 * misbehaving — not the user's session dying.
 */
const INVALID_SESSION_STATUSES = [400, 401, 403]

export const isSessionDead = (error: AuthError | null) =>
  error === null ||
  isAuthSessionMissingError(error) ||
  (isAuthApiError(error) && INVALID_SESSION_STATUSES.includes(error.status))

/** AuthUnknownError wraps the root cause — that's where `fetch failed` lives. */
const readCause = (error: AuthError) =>
  'originalError' in error && error.originalError instanceof Error
    ? error.originalError.message
    : null

/**
 * One structured line per null user, returning the same verdict as
 * `isSessionDead` so callers don't classify twice.
 *
 * The distinction above is the whole defence, and nothing recorded which way it
 * went — which is how these came to be attributed to token rotation with no
 * measurement behind it. Log what actually arrived instead.
 */
export const classifyNullUser = (context: string, error: AuthError | null) => {
  const isDead = isSessionDead(error)
  console.warn('[auth] null user', {
    context,
    verdict: isDead ? 'signed-out' : 'transient',
    error: error?.name ?? null,
    code: error?.code ?? null,
    status: error?.status ?? null,
    cause: error === null ? null : readCause(error),
  })
  return isDead
}
