import { createAdminClient } from '@/lib/supabase/admin'

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'

/** Refresh when within this window of expiry. */
const EXPIRY_BUFFER_MS = 60_000

export type SpotifyTokenResult =
  | { status: 'ok'; accessToken: string }
  /**
   * No usable tokens (row missing, or Spotify returned invalid_grant —
   * refresh tokens expire after 6 months of inactivity). The UI should
   * prompt "Reconnect Spotify"; a fresh sign-in re-captures tokens.
   */
  | { status: 'reconnect_required' }
  | { status: 'error'; message: string }

/**
 * Returns a valid Spotify access token for the user, refreshing against
 * Spotify when expired. Server-side only (service-role reads).
 */
export async function getValidSpotifyToken(
  userId: string,
): Promise<SpotifyTokenResult> {
  const admin = createAdminClient()

  const { data: row, error } = await admin
    .from('spotify_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return { status: 'error', message: error.message }
  if (!row) return { status: 'reconnect_required' }

  const expiresAt = new Date(row.expires_at).getTime()
  if (expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return { status: 'ok', accessToken: row.access_token }
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return { status: 'error', message: 'Missing Spotify client credentials' }
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }),
  })

  if (!response.ok) {
    let isInvalidGrant = false
    try {
      const payload: unknown = await response.json()
      isInvalidGrant =
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        payload.error === 'invalid_grant'
    } catch {
      // non-JSON error body; fall through to generic error
    }
    if (isInvalidGrant) {
      // Token revoked or expired. Deleting the row makes "row missing" the
      // single reconnect-required signal the UI checks.
      await admin.from('spotify_tokens').delete().eq('user_id', userId)
      return { status: 'reconnect_required' }
    }
    return {
      status: 'error',
      message: `Spotify token refresh failed (HTTP ${response.status})`,
    }
  }

  const refreshed = parseRefreshResponse(await response.json())
  if (!refreshed)
    return {
      status: 'error',
      message: 'Spotify returned an unexpected refresh payload',
    }

  const { error: updateError } = await admin
    .from('spotify_tokens')
    .update({
      access_token: refreshed.accessToken,
      // Spotify may rotate the refresh token; keep the old one otherwise.
      refresh_token: refreshed.refreshToken ?? row.refresh_token,
      expires_at: new Date(
        Date.now() + (refreshed.expiresIn - 60) * 1000,
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  if (updateError) return { status: 'error', message: updateError.message }

  return { status: 'ok', accessToken: refreshed.accessToken }
}

interface RefreshedTokens {
  accessToken: string
  expiresIn: number
  refreshToken?: string
}

function parseRefreshResponse(value: unknown): RefreshedTokens | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('access_token' in value) || typeof value.access_token !== 'string')
    return null
  if (!('expires_in' in value) || typeof value.expires_in !== 'number')
    return null

  return {
    accessToken: value.access_token,
    expiresIn: value.expires_in,
    refreshToken:
      'refresh_token' in value && typeof value.refresh_token === 'string'
        ? value.refresh_token
        : undefined,
  }
}
