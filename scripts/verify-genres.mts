// Genre vocabulary verification: proves the fuzzy near-duplicate snapping in
// lib/vocabulary.ts is tuned so real genres never merge while known
// misspellings do, and that the dembow cleanup left no malformed rows behind.
//
// Usage: node --env-file=.env.local --import tsx scripts/verify-genres.mts
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../lib/supabase/types'
import {
  FUZZY_MIN_LENGTH,
  FUZZY_THRESHOLD,
  snapToExistingName,
  trigramSimilarity,
} from '../lib/vocabulary'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'Missing env vars — run with: node --env-file=.env.local --import tsx',
  )
  process.exit(1)
}

const service = createClient<Database>(url, serviceKey)

// The dembow variants merged by scripts/backfill-genre-aliases.mts. Pairs here
// are expected to be similar, so they are exempt from the "no legit pair
// merges" sweep (relevant only if verify runs before the backfill).
const KNOWN_VARIANTS = new Map<string, string>([
  ['dem bow', 'dembow'],
  ['dominic dembow', 'dominican dembow'],
  ['dominion dembow', 'dominican dembow'],
])
const BAD_NAMES = [...KNOWN_VARIANTS.keys()]
const canonicalOf = (name: string) => KNOWN_VARIANTS.get(name) ?? name

const failures: string[] = []

const hard = (label: string, ok: boolean, detail?: string) => {
  if (!ok) failures.push(label)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const genreRows = await service.from('genres').select('id, name')
if (genreRows.error) {
  console.error('Could not read genres:', genreRows.error.message)
  process.exit(1)
}
const names = genreRows.data.map((row) => row.name)

// 1. No two distinct real genres snap onto each other (either direction),
//    excluding the known dembow variants. This locks FUZZY_THRESHOLD against
//    the real catalog.
const collisions: string[] = []
for (const a of names) {
  for (const b of names) {
    if (a === b) continue
    if (canonicalOf(a) === canonicalOf(b)) continue
    if (snapToExistingName(a, [b]) !== null) collisions.push(`${a} → ${b}`)
  }
}
hard(
  'no legit genre pair snaps together',
  collisions.length === 0,
  collisions.length > 0 ? `[${collisions.join(', ')}]` : `pairs=${names.length}`,
)

// 2. Known misspellings snap onto their canonical spelling (literal, so this
//    holds regardless of current DB state).
const expectSnap = (
  candidate: string,
  vocab: string[],
  expected: string | null,
) => {
  const got = snapToExistingName(candidate, vocab)
  hard(
    `snap "${candidate}" → ${expected ?? 'null'}`,
    got === expected,
    got === expected ? '' : `got=${got ?? 'null'}`,
  )
}
expectSnap('dominic dembow', ['dominican dembow'], 'dominican dembow') // trigram
expectSnap('dominion dembow', ['dominican dembow'], 'dominican dembow') // trigram
expectSnap('dem bow', ['dembow'], 'dembow') // space-insensitive
expectSnap('dominican dembo', ['dominican dembow'], 'dominican dembow') // novel typo
// Negative controls: genuinely distinct genres must not merge.
expectSnap('reggae', ['reggaeton'], null)
expectSnap('latin pop', ['latin rock'], null)

// 3. The cleanup left no malformed rows and no dangling links.
const remnants = names.filter((name) => BAD_NAMES.includes(name))
hard(
  'no known-bad genre names remain',
  remnants.length === 0,
  remnants.length > 0 ? `[${remnants.join(', ')}]` : 'count=0',
)

const genreIds = new Set(genreRows.data.map((row) => row.id))
for (const table of ['song_genres', 'user_genres'] as const) {
  const links = await service.from(table).select('genre_id').limit(10000)
  if (links.error) {
    hard(`${table} has no orphaned genre_id`, false, links.error.message)
    continue
  }
  const orphans = links.data.filter((row) => !genreIds.has(row.genre_id)).length
  hard(`${table} has no orphaned genre_id`, orphans === 0, `count=${orphans}`)
}

console.log('')
console.log(`INFO  FUZZY_THRESHOLD=${FUZZY_THRESHOLD} MIN_LENGTH=${FUZZY_MIN_LENGTH}`)

// Show the closest real genre pairs so the threshold margin is visible.
const scored: { pair: string; score: number }[] = []
for (let i = 0; i < names.length; i += 1) {
  for (let j = i + 1; j < names.length; j += 1) {
    const a = names[i]
    const b = names[j]
    if (canonicalOf(a) === canonicalOf(b)) continue
    scored.push({ pair: `${a} / ${b}`, score: trigramSimilarity(a, b) })
  }
}
scored.sort((x, y) => y.score - x.score)
for (const { pair, score } of scored.slice(0, 5)) {
  console.log(`INFO  closest legit pair: ${pair} = ${score.toFixed(3)}`)
}

console.log(
  failures.length > 0
    ? '\nGENRE VOCAB CHECKS FAILED: see FAIL lines above.'
    : '\nGENRE VOCAB OK: fuzzy snapping is safe and cleanup is complete.',
)
process.exit(failures.length > 0 ? 1 : 0)
