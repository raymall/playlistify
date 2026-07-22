// RLS verification: an anonymous (signed-out) client must see ZERO rows on
// every table — no anon policies exist. Run after signing in so private
// tables actually contain rows (service>0 + anon=0 proves RLS bites).
// Prints row counts only, never values.
//
// Usage: node --env-file=.env.local scripts/verify-rls.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  console.error('Missing env vars — run with: node --env-file=.env.local')
  process.exit(1)
}

const anon = createClient(url, anonKey)
const service = createClient(url, serviceKey)

const TABLES = [
  'spotify_tokens',
  'profiles',
  'user_songs',
  'user_genres',
  'user_moods',
  'playlists',
  'playlist_songs',
  'songs',
  'genres',
  'moods',
  'song_genres',
  'song_moods',
  'llm_models',
]

let failed = false

for (const table of TABLES) {
  const [serviceRes, anonRes] = await Promise.all([
    service.from(table).select('*', { count: 'exact', head: true }),
    anon.from(table).select('*', { count: 'exact', head: true }),
  ])

  const serviceCount = serviceRes.error
    ? `err(${serviceRes.error.message})`
    : serviceRes.count
  const anonBlocked = anonRes.error !== null || anonRes.count === 0
  if (!anonBlocked) failed = true

  console.log(
    `${anonBlocked ? 'PASS' : 'FAIL'}  ${table.padEnd(16)} service=${serviceCount}  anon=${anonRes.error ? 'denied' : anonRes.count}`,
  )
}

console.log(
  failed
    ? '\nRLS FAILURE: anon can read rows somewhere above.'
    : '\nRLS OK: anon sees zero rows everywhere.',
)
process.exit(failed ? 1 : 0)
