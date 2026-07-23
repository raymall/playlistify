// One-time cleanup: merges the malformed dembow genre variants into their
// canonical rows. Re-points the AI (song_genres) and personal (user_genres)
// links, then deletes the bad vocabulary row — its ON DELETE CASCADE FKs drop
// the now-orphaned links. Idempotent: absent names are skipped, so it is safe
// to re-run. Prints counts only, never song or user values.
//
// Usage: node --env-file=.env.local --import tsx scripts/backfill-genre-aliases.mts
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../lib/supabase/types'

// Explicit, reviewed bad → good mapping — deliberately local to this cleanup,
// not a persistent app concept (fuzzy snapping guards future writes).
const MERGES: { bad: string; good: string }[] = [
  { bad: 'dem bow', good: 'dembow' },
  { bad: 'dominic dembow', good: 'dominican dembow' },
  { bad: 'dominion dembow', good: 'dominican dembow' },
]

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'Missing env vars — run with: node --env-file=.env.local --import tsx',
  )
  process.exit(1)
}

const service = createClient<Database>(url, serviceKey)

const idForName = async (name: string) => {
  const { data, error } = await service
    .from('genres')
    .select('id')
    .eq('name', name)
    .maybeSingle()
  if (error) throw new Error(`lookup "${name}": ${error.message}`)
  return data?.id ?? null
}

for (const { bad, good } of MERGES) {
  const badId = await idForName(bad)
  if (badId === null) {
    console.log(`SKIP  "${bad}" not present`)
    continue
  }
  const goodId = await idForName(good)
  if (goodId === null) {
    console.error(`ABORT "${good}" (canonical target) is missing`)
    process.exit(1)
  }

  // Re-point AI links.
  const aiLinks = await service
    .from('song_genres')
    .select('song_id')
    .eq('genre_id', badId)
  if (aiLinks.error) {
    console.error(`song_genres read failed: ${aiLinks.error.message}`)
    process.exit(1)
  }
  if (aiLinks.data.length > 0) {
    const moved = await service.from('song_genres').upsert(
      aiLinks.data.map((row) => ({ song_id: row.song_id, genre_id: goodId })),
      { onConflict: 'song_id,genre_id', ignoreDuplicates: true },
    )
    if (moved.error) {
      console.error(`song_genres repoint failed: ${moved.error.message}`)
      process.exit(1)
    }
  }

  // Re-point personal links.
  const userLinks = await service
    .from('user_genres')
    .select('user_id, song_id')
    .eq('genre_id', badId)
  if (userLinks.error) {
    console.error(`user_genres read failed: ${userLinks.error.message}`)
    process.exit(1)
  }
  if (userLinks.data.length > 0) {
    const moved = await service.from('user_genres').upsert(
      userLinks.data.map((row) => ({
        user_id: row.user_id,
        song_id: row.song_id,
        genre_id: goodId,
      })),
      { onConflict: 'user_id,song_id,genre_id', ignoreDuplicates: true },
    )
    if (moved.error) {
      console.error(`user_genres repoint failed: ${moved.error.message}`)
      process.exit(1)
    }
  }

  // Drop the bad vocabulary row; the cascade removes its leftover links.
  const removed = await service.from('genres').delete().eq('id', badId)
  if (removed.error) {
    console.error(`delete "${bad}" failed: ${removed.error.message}`)
    process.exit(1)
  }

  console.log(
    `MERGED "${bad}" → "${good}"  (ai=${aiLinks.data.length}, user=${userLinks.data.length})`,
  )
}

console.log('\nBACKFILL OK: dembow variants merged.')
