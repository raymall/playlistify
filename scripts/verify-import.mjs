// Import verification: asserts the invariants the library sync guarantees —
// Liked Songs, owned playlists, saved albums, and the per-source membership
// rows behind them — then prints informational counts. Prints counts only,
// never track values.
//
// In this MVP every song in `songs` is created by an import that also writes a
// `user_songs` row, so the global `songs` table equals the user-referenced set —
// the title/genre checks below scope to `songs` directly.
//
// Usage: node --env-file=.env.local scripts/verify-import.mjs
import { createClient } from '@supabase/supabase-js'

import { requireEnv } from './lib/env.mjs'
import { createChecker, headCount } from './lib/verify.mjs'

const [url, anonKey, serviceKey] = requireEnv([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
])

const service = createClient(url, serviceKey)
const anon = createClient(url, anonKey)

const { hard, hasFailed } = createChecker()

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

// Hard: every library row is held by at least one source. The whole-library
// sync removes a song only when a completed pass finds it in no source, so a
// row with zero source rows would be unprunable and unexplained. PostgREST
// cannot express NOT EXISTS, so both sides are paged and compared here.
const PAGE = 1000
const readPairs = async (table) => {
  const pairs = new Set()
  for (let from = 0; ; from += PAGE) {
    const page = await service
      .from(table)
      .select('user_id, song_id')
      .order('user_id', { ascending: true })
      .order('song_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (page.error) return { pairs, error: page.error }
    for (const row of page.data) pairs.add(`${row.user_id}:${row.song_id}`)
    if (page.data.length < PAGE) return { pairs, error: null }
  }
}
const libraryPairs = await readPairs('user_songs')
const sourcePairs = await readPairs('user_song_sources')
let sourcelessCount = 0
for (const pair of libraryPairs.pairs) {
  if (!sourcePairs.pairs.has(pair)) sourcelessCount += 1
}
hard(
  'user_songs rows with no user_song_sources row = 0',
  libraryPairs.error === null &&
    sourcePairs.error === null &&
    sourcelessCount === 0,
  libraryPairs.error || sourcePairs.error
    ? `err(${(libraryPairs.error ?? sourcePairs.error).message})`
    : `count=${sourcelessCount}`,
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

// Hard: same canary for the per-source membership table.
const anonSources = await anon
  .from('user_song_sources')
  .select('song_id', { count: 'exact', head: true })
const anonSourcesBlocked = anonSources.error !== null || anonSources.count === 0
hard(
  'anon sees 0 user_song_sources (RLS)',
  anonSourcesBlocked,
  anonSources.error ? 'denied' : `count=${anonSources.count}`,
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

for (const sourceType of ['liked', 'playlist', 'album']) {
  const row = await headCount(
    service
      .from('user_song_sources')
      .select('song_id', { count: 'exact', head: true })
      .eq('source_type', sourceType),
  )
  console.log(`INFO  user_song_sources source_type=${sourceType}: ${row.count}`)
}

const emptyGenres = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .eq('spotify_genres', '{}'),
)
console.log(
  `INFO  songs with []-genres = ${emptyGenres.error ? `err(${emptyGenres.error.message})` : emptyGenres.count}`,
)

for (const status of ['pending', 'enriched', 'unknown']) {
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

// Optional: compare Spotify's reported Liked Songs total against the user's
// `liked` source rows for one user with a still-valid token (skipped
// otherwise). Only the liked source is comparable — playlists and albums add
// library rows Spotify's Liked Songs total knows nothing about. The diff is
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
        .from('user_song_sources')
        .select('song_id', { count: 'exact', head: true })
        .eq('user_id', tokenRow.data.user_id)
        .eq('source_type', 'liked'),
    )
    hard(
      'liked source rows do not exceed the Spotify Liked Songs total',
      userCount.error === null &&
        typeof spotifyTotal === 'number' &&
        userCount.count <= spotifyTotal,
      userCount.error
        ? `err(${userCount.error.message})`
        : `spotify=${spotifyTotal} imported=${userCount.count}`,
    )
    console.log(
      `INFO  spotify liked total=${spotifyTotal} vs liked source rows=${userCount.count} (diff includes local files)`,
    )
  } else {
    console.log(`INFO  spotify check skipped (HTTP ${response.status})`)
  }
} else {
  console.log('INFO  spotify check skipped (no valid token)')
}

console.log(
  hasFailed()
    ? '\nIMPORT INVARIANTS FAILED: see FAIL lines above.'
    : '\nIMPORT OK: all invariants hold.',
)
process.exit(hasFailed() ? 1 : 0)
