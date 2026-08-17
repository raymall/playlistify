// Vocabulary verification for the two opposite tag policies:
//
//   CLOSED (enrichment) — the approved lists are reachable by exact match, and
//   no AI tag link points at an unapproved row.
//   OPEN (personal tags) — free-form names live in the same tables as
//   unapproved rows and are expected to be there; their presence is health, not
//   a leak.
//
// Matching is exact on the normalized name (lib/vocabulary.ts), so a name is
// reachable if and only if it is already normalized — that is the check.
//
// Usage: node --env-file=.env.local --import tsx scripts/verify-genres.mts
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../lib/supabase/types'
import { isValidTagName, normalizeTagName } from '../lib/vocabulary'
import { requireEnv } from './lib/env.mjs'

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

const service = createClient<Database>(url, serviceKey)

const failures: string[] = []

const hard = (label: string, ok: boolean, detail?: string) => {
  if (!ok) failures.push(label)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

const approvedByTable = new Map<'genres' | 'moods', string[]>()
const unapprovedCounts = new Map<'genres' | 'moods', number>()

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
  unapprovedCounts.set(table, rows.data.length - approved.length)

  hard(`${table}: approved vocabulary present`, approved.length > 0)

  // 1. Every name in the table is already normalized and valid — approved and
  //    free-form alike. Matching is exact, so a denormalized row is
  //    permanently unreachable: neither the model nor a chat request can
  //    produce a string that still equals it after normalization. The write
  //    paths are the only thing keeping this true, and nothing in the schema
  //    enforces it.
  const denormalized = rows.data
    .map((row) => row.name)
    .filter((name) => normalizeTagName(name) !== name || !isValidTagName(name))
  hard(
    `${table}: every name normalized and reachable`,
    denormalized.length === 0,
    denormalized.length > 0
      ? `[${denormalized.join(', ')}]`
      : `approved=${approved.length} total=${rows.data.length}`,
  )

  // 2. No AI tag link points at an unapproved row. The closed matcher and the
  //    `is_approved` join inside promote_song_enrichment_attempt are the only
  //    two writers, so one escaping means a gate leaks. This is the check that
  //    keeps personal tags out of AI results now that they are free-form.
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

// 3. Names approved as both a genre and a mood resolve in either vocabulary.
//    The matcher searches one kind at a time, so dual approval is the only
//    thing keeping these off unmatched_tags when the model returns a word it
//    knows as a genre in the moods slot.
const approvedGenres = new Set(approvedByTable.get('genres') ?? [])
const approvedMoods = new Set(approvedByTable.get('moods') ?? [])
for (const name of ['melancholic', 'chill', 'dance', 'urban']) {
  hard(
    `dual-kind "${name}": approved as both genre and mood`,
    approvedGenres.has(name) && approvedMoods.has(name),
    `genre=${approvedGenres.has(name)} mood=${approvedMoods.has(name)}`,
  )
}

console.log('')
console.log(
  `INFO  matching is exact — approved genres=${approvedGenres.size} moods=${approvedMoods.size}`,
)
console.log(
  `INFO  free-form (unapproved) rows: genres=${unapprovedCounts.get('genres') ?? 0} moods=${unapprovedCounts.get('moods') ?? 0}`,
)

console.log(
  failures.length > 0
    ? '\nVOCAB CHECKS FAILED: see FAIL lines above.'
    : '\nVOCAB OK: every name is exactly reachable and AI links are gated.',
)
process.exit(failures.length > 0 ? 1 : 0)
