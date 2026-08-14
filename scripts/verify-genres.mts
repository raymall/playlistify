// Vocabulary verification for the closed (approved) enrichment vocabulary:
// proves both approved lists resolve deterministically under the fuzzy
// snapper in lib/vocabulary.ts, that known variant spellings land on their
// approved canonical, and that no AI tag link points at an unapproved row.
//
// Usage: node --env-file=.env.local --import tsx scripts/verify-genres.mts
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../lib/supabase/types'
import {
  FUZZY_MIN_LENGTH,
  FUZZY_THRESHOLD,
  isValidTagName,
  normalizeTagName,
  snapToExistingName,
  trigramSimilarity,
} from '../lib/vocabulary'
import { requireEnv } from './lib/env.mjs'

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

const service = createClient<Database>(url, serviceKey)

// Approved pairs inside trigram-snapping distance that are real, deliberately
// distinct styles. Exact matching wins before fuzzy, so verbatim model output
// still resolves correctly; only a typo near one of these is ambiguous. Any
// NEW pair showing up here must be reviewed (rename one side in the seed, or
// accept it into this list) — that is the check, not a formality.
const REVIEWED_CLOSE_PAIRS = new Set([
  'afrobeat / afrobeats',
  'american / americana',
  'boogie / boogie-woogie',
  'classic / classical',
  'tropical / tropicalia',
])

const failures: string[] = []

const hard = (label: string, ok: boolean, detail?: string) => {
  if (!ok) failures.push(label)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const approvedByTable = new Map<'genres' | 'moods', string[]>()

for (const table of ['genres', 'moods'] as const) {
  const rows = await service.from(table).select('name, is_approved')
  if (rows.error) {
    console.error(`Could not read ${table}:`, rows.error.message)
    process.exit(1)
  }
  const approved = rows.data
    .filter((row) => row.is_approved)
    .map((row) => row.name)
  approvedByTable.set(table, approved)

  hard(`${table}: approved vocabulary present`, approved.length > 0)

  // 1. Every approved name is already normalized and valid — the matcher
  //    compares against normalized model output, so a denormalized approved
  //    name would be unreachable.
  const denormalized = approved.filter(
    (name) => normalizeTagName(name) !== name || !isValidTagName(name),
  )
  hard(
    `${table}: approved names normalized`,
    denormalized.length === 0,
    denormalized.length > 0
      ? `[${denormalized.join(', ')}]`
      : `count=${approved.length}`,
  )

  // 2. No two approved names collide space-insensitively — that tier of the
  //    snapper is exact, so a collision would make resolution order-dependent.
  const byDespaced = new Map<string, string>()
  const collisions: string[] = []
  for (const name of approved) {
    const key = name.replace(/ /g, '')
    const other = byDespaced.get(key)
    if (other !== undefined) collisions.push(`${other} / ${name}`)
    byDespaced.set(key, name)
  }
  hard(
    `${table}: no space-insensitive collisions`,
    collisions.length === 0,
    collisions.length > 0 ? `[${collisions.join(', ')}]` : '',
  )

  // 3. Every approved name resolves to itself through the matcher.
  const misresolved = approved.filter(
    (name) => snapToExistingName(name, approved) !== name,
  )
  hard(
    `${table}: every approved name self-resolves`,
    misresolved.length === 0,
    misresolved.length > 0 ? `[${misresolved.join(', ')}]` : '',
  )

  // 4. Trigram-close approved pairs are exactly the reviewed set.
  const unreviewed: string[] = []
  for (let i = 0; i < approved.length; i += 1) {
    for (let j = i + 1; j < approved.length; j += 1) {
      const [a, b] = [approved[i], approved[j]].sort()
      if (a.length < FUZZY_MIN_LENGTH || b.length < FUZZY_MIN_LENGTH) continue
      if (trigramSimilarity(a, b) < FUZZY_THRESHOLD) continue
      if (!REVIEWED_CLOSE_PAIRS.has(`${a} / ${b}`)) {
        unreviewed.push(`${a} / ${b}`)
      }
    }
  }
  hard(
    `${table}: close pairs all reviewed`,
    unreviewed.length === 0,
    unreviewed.length > 0 ? `[${unreviewed.join(', ')}]` : '',
  )

  // 5. No AI tag link points at an unapproved row — the closed matcher is
  //    the only writer, so one escaping means the gate leaks.
  const linkTable = table === 'genres' ? 'song_genres' : 'song_moods'
  const leaked = await service
    .from(linkTable)
    .select(`${table}!inner(is_approved)`, { count: 'exact', head: true })
    .eq(`${table}.is_approved`, false)
  hard(
    `${linkTable}: no links to unapproved rows`,
    leaked.error === null && (leaked.count ?? 0) === 0,
    leaked.error?.message ?? `count=${leaked.count ?? 0}`,
  )
}

// 6. Known variant spellings resolve onto their approved canonical (literal
//    lists, so these hold regardless of DB state) — and legacy compound tags
//    from the pre-atomic vocabulary drop to unmatched instead of snapping.
const approvedGenres = approvedByTable.get('genres') ?? []
const approvedMoods = approvedByTable.get('moods') ?? []

const expectSnap = (
  label: string,
  candidate: string,
  vocab: string[],
  expected: string | null,
) => {
  const got = snapToExistingName(candidate, vocab)
  hard(
    `snap ${label}: "${candidate}" → ${expected ?? 'null'}`,
    got === expected,
    got === expected ? '' : `got=${got ?? 'null'}`,
  )
}

expectSnap('space variant', 'afro beat', approvedGenres, 'afrobeat')
expectSnap('space variant', 'hiphop', approvedGenres, 'hip hop')
expectSnap('typo', 'regaeton', approvedGenres, 'reggaeton')
expectSnap('legacy compound', 'dominican dembow', approvedGenres, null)
expectSnap('short tag, no fuzzy', 'mello', approvedMoods, null)
expectSnap('space variant', 'up beat', approvedMoods, 'upbeat')

// Names approved as both a genre and a mood must resolve in either vocabulary.
// The matcher searches one kind at a time, so dual approval is the only thing
// keeping these off unmatched_tags when the model returns them as moods.
for (const name of ['melancholic', 'chill', 'dance', 'urban']) {
  expectSnap('dual-kind', name, approvedMoods, name)
  expectSnap('dual-kind', name, approvedGenres, name)
}

console.log('')
console.log(
  `INFO  FUZZY_THRESHOLD=${FUZZY_THRESHOLD} MIN_LENGTH=${FUZZY_MIN_LENGTH}`,
)

// Closest approved pairs per vocabulary, so the threshold margin stays
// visible as the lists evolve.
for (const [table, approved] of approvedByTable) {
  const scored: { pair: string; score: number }[] = []
  for (let i = 0; i < approved.length; i += 1) {
    for (let j = i + 1; j < approved.length; j += 1) {
      const a = approved[i]
      const b = approved[j]
      scored.push({ pair: `${a} / ${b}`, score: trigramSimilarity(a, b) })
    }
  }
  scored.sort((x, y) => y.score - x.score)
  for (const { pair, score } of scored.slice(0, 5)) {
    console.log(`INFO  ${table} closest pair: ${pair} = ${score.toFixed(3)}`)
  }
}

console.log(
  failures.length > 0
    ? '\nVOCAB CHECKS FAILED: see FAIL lines above.'
    : '\nVOCAB OK: approved lists resolve deterministically and AI links are gated.',
)
process.exit(failures.length > 0 ? 1 : 0)
