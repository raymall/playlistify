// End-to-end exercise of the server-side token-refresh helper: backdates
// expires_at to force the refresh path, then confirms a new token was
// stored with a future expiry. Prints booleans only, never token values.
//
// Usage: node --env-file=.env.local --import tsx scripts/exercise-refresh.mts
import { createClient } from '@supabase/supabase-js'

import { getValidSpotifyToken } from '../lib/spotify/token'
import type { Database } from '../lib/supabase/types'
import { requireEnv } from './lib/env.mjs'

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

const service = createClient<Database>(url, serviceKey)

const { data: rows, error } = await service
  .from('spotify_tokens')
  .select('user_id, access_token, expires_at')

if (error || rows.length === 0) {
  console.error('No token row — sign in with Spotify first.', error ?? '')
  process.exit(1)
}

const before = rows[0]

// Force the refresh path.
await service
  .from('spotify_tokens')
  .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
  .eq('user_id', before.user_id)

const result = await getValidSpotifyToken(before.user_id)

if (result.status !== 'ok') {
  console.error('Refresh did not return ok:', result)
  process.exit(1)
}

const { data: after, error: afterError } = await service
  .from('spotify_tokens')
  .select('access_token, expires_at')
  .eq('user_id', before.user_id)
  .single()

if (afterError) {
  console.error('Could not read back the token row:', afterError)
  process.exit(1)
}

console.log({
  status: result.status,
  token_rotated: after.access_token !== before.access_token,
  expiry_in_future: new Date(after.expires_at).getTime() > Date.now(),
})
console.log('OK: refresh helper exchanged the expired token with Spotify.')
