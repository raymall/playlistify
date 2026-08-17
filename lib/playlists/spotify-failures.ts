// Shared mapping from Spotify token/API failures onto the common failure arms
// of the playlist-engine response unions. Callers narrow away the 'ok' arm
// first, so the typed success payload never passes through here. Deliberately
// NOT used where an engine customizes the mapping (build.ts's add-tracks
// error message, delete.ts's best-effort logging).

import type { SpotifyApiResult } from '@/lib/spotify/api'
import type { SpotifyTokenResult } from '@/lib/spotify/token'

type SpotifyFailureResponse =
  | { status: 'reconnect_required' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'error'; message: string }

export const mapTokenFailure = (
  result: Exclude<SpotifyTokenResult, { status: 'ok' }>,
): SpotifyFailureResponse =>
  result.status === 'reconnect_required'
    ? { status: 'reconnect_required' }
    : { status: 'error', message: result.message }

export const mapSpotifyFailure = (
  result: Exclude<SpotifyApiResult<unknown>, { status: 'ok' }>,
): SpotifyFailureResponse => {
  if (result.status === 'auth_failed') return { status: 'reconnect_required' }
  if (result.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfterSeconds: result.retryAfterSeconds,
    }
  }
  return { status: 'error', message: result.message }
}
