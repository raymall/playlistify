// Import verification: asserts the invariants the Liked Songs import guarantees,
// then prints informational counts. Prints counts only, never track values.
//
// In this MVP every song in `songs` is created by an import that also writes a
// `user_songs` row, so the global `songs` table equals the user-referenced set —
// the title/genre checks below scope to `songs` directly.
//
// Usage: node --env-file=.env.local scripts/verify-import.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  console.error('Missing env vars — run with: node --env-file=.env.local')
  process.exit(1)
}

const service = createClient(url, serviceKey)
const anon = createClient(url, anonKey)

let failed = false

const headCount = async (query) => {
  const { count, error } = await query
  return { count: count ?? 0, error }
}

const hard = (label, ok, detail) => {
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

// Hard: no user-referenced song has a null or empty title.
const nullTitle = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .is('title', null),
)
const emptyTitle = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .eq('title', ''),
)
const badTitles = nullTitle.count + emptyTitle.count
hard('songs with null/empty title = 0', badTitles === 0, `count=${badTitles}`)

// Hard: every user_songs row carries a liked_at timestamp.
const nullLiked = await headCount(
  service
    .from('user_songs')
    .select('song_id', { count: 'exact', head: true })
    .is('liked_at', null),
)
hard(
  'user_songs with null liked_at = 0',
  nullLiked.count === 0,
  `count=${nullLiked.count}`,
)

// Hard: import always writes spotify_genres >= []; a NULL means a logic bug
// (a 429 aborts before any write, so it can never leave a NULL behind).
const nullGenres = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .is('spotify_genres', null),
)
hard(
  'songs with spotify_genres NULL = 0',
  nullGenres.count === 0,
  `count=${nullGenres.count}`,
)

// Hard: an anonymous client must see zero user_songs (RLS canary).
const anonUserSongs = await anon
  .from('user_songs')
  .select('song_id', { count: 'exact', head: true })
const anonBlocked = anonUserSongs.error !== null || anonUserSongs.count === 0
hard(
  'anon sees 0 user_songs (RLS)',
  anonBlocked,
  anonUserSongs.error ? 'denied' : `count=${anonUserSongs.count}`,
)

console.log('')

// Informational counts.
const songsTotal = await headCount(
  service.from('songs').select('id', { count: 'exact', head: true }),
)
const userSongsTotal = await headCount(
  service.from('user_songs').select('song_id', { count: 'exact', head: true }),
)
console.log(
  `INFO  songs=${songsTotal.count}  user_songs=${userSongsTotal.count}`,
)

const emptyGenres = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .eq('spotify_genres', '{}'),
)
console.log(
  `INFO  songs with []-genres = ${emptyGenres.error ? `err(${emptyGenres.error.message})` : emptyGenres.count}`,
)

for (const status of ['pending', 'enriched', 'failed', 'skipped']) {
  const row = await headCount(
    service
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .eq('enrichment_status', status),
  )
  console.log(`INFO  enrichment_status=${status}: ${row.count}`)
}

const minRow = await service
  .from('songs')
  .select('release_date')
  .not('release_date', 'is', null)
  .order('release_date', { ascending: true })
  .limit(1)
  .maybeSingle()
const maxRow = await service
  .from('songs')
  .select('release_date')
  .not('release_date', 'is', null)
  .order('release_date', { ascending: false })
  .limit(1)
  .maybeSingle()
console.log(
  `INFO  release_date range: ${minRow.data?.release_date ?? 'n/a'} .. ${maxRow.data?.release_date ?? 'n/a'}`,
)

// Optional: compare Spotify's reported Liked Songs total against the imported
// count for one user with a still-valid token (skipped otherwise). The diff is
// expected to be non-zero — Spotify counts local files, which we don't import.
const tokenRow = await service
  .from('spotify_tokens')
  .select('user_id, access_token, expires_at')
  .limit(1)
  .maybeSingle()

if (
  tokenRow.data &&
  new Date(tokenRow.data.expires_at).getTime() > Date.now()
) {
  const response = await fetch('https://api.spotify.com/v1/me/tracks?limit=1', {
    headers: { Authorization: `Bearer ${tokenRow.data.access_token}` },
  })
  if (response.ok) {
    const body = await response.json()
    const spotifyTotal = typeof body?.total === 'number' ? body.total : 'n/a'
    const userCount = await headCount(
      service
        .from('user_songs')
        .select('song_id', { count: 'exact', head: true })
        .eq('user_id', tokenRow.data.user_id),
    )
    console.log(
      `INFO  spotify total=${spotifyTotal} vs user_songs=${userCount.count} (diff includes local files)`,
    )
  } else {
    console.log(`INFO  spotify check skipped (HTTP ${response.status})`)
  }
} else {
  console.log('INFO  spotify check skipped (no valid token)')
}

console.log(
  failed
    ? '\nIMPORT INVARIANTS FAILED: see FAIL lines above.'
    : '\nIMPORT OK: all invariants hold.',
)
process.exit(failed ? 1 : 0)
