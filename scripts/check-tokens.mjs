// Confirms a spotify_tokens row exists after sign-in. Prints metadata only
// (user_id, timestamps) — never token values.
//
// Usage: node --env-file=.env.local scripts/check-tokens.mjs
import { createClient } from '@supabase/supabase-js'

import { requireEnv } from './lib/env.mjs'

const [url, serviceKey] = requireEnv([
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
])

const service = createClient(url, serviceKey)

const { data, error } = await service
  .from('spotify_tokens')
  .select('user_id, expires_at, updated_at')

if (error) {
  console.error('query failed:', error.message)
  process.exit(1)
}

if (!data.length) {
  console.log('NO token rows — sign in with Spotify first.')
  process.exit(1)
}

for (const row of data) {
  console.log({
    user_id: row.user_id,
    expires_at: row.expires_at,
    expires_in_future: new Date(row.expires_at).getTime() > Date.now(),
    updated_at: row.updated_at,
  })
}
console.log(`OK: ${data.length} token row(s) present.`)
