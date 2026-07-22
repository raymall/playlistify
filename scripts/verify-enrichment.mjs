// Enrichment verification: asserts the invariants the LLM enrichment pipeline
// guarantees, then prints informational counts. Prints counts only, never
// song or tag values.
//
// Usage: node --env-file=.env.local scripts/verify-enrichment.mjs
import { createClient } from '@supabase/supabase-js'

// Keep in sync with CONFIDENCE_THRESHOLD in lib/enrichment/schema.ts.
const CONFIDENCE_THRESHOLD = 0.4

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

// Hard: every enriched row carries the full enrichment column set.
for (const column of [
  'ai_confidence',
  'enrichment_model',
  'enriched_at',
  'ai_attributes',
]) {
  const row = await headCount(
    service
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .eq('enrichment_status', 'enriched')
      .is(column, null),
  )
  hard(
    `enriched rows with null ${column} = 0`,
    row.count === 0,
    `count=${row.count}`,
  )
}

// Hard: unknown rows carry confidence/model/timestamp (attributes stay null).
for (const column of ['ai_confidence', 'enrichment_model', 'enriched_at']) {
  const row = await headCount(
    service
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .eq('enrichment_status', 'unknown')
      .is(column, null),
  )
  hard(
    `unknown rows with null ${column} = 0`,
    row.count === 0,
    `count=${row.count}`,
  )
}

// Hard: unknown means the stored (rounded) confidence sits below the threshold.
const confidentUnknown = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .eq('enrichment_status', 'unknown')
    .gte('ai_confidence', CONFIDENCE_THRESHOLD),
)
hard(
  `unknown rows with ai_confidence >= ${CONFIDENCE_THRESHOLD} = 0`,
  confidentUnknown.count === 0,
  `count=${confidentUnknown.count}`,
)

// Hard: pending rows carry no enrichment output.
for (const column of ['enriched_at', 'ai_attributes']) {
  const row = await headCount(
    service
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .eq('enrichment_status', 'pending')
      .not(column, 'is', null),
  )
  hard(
    `pending rows with ${column} set = 0`,
    row.count === 0,
    `count=${row.count}`,
  )
}

// Hard: no AI tag links on songs that are still pending.
for (const table of ['song_genres', 'song_moods']) {
  const row = await headCount(
    service
      .from(table)
      .select('song_id, songs!inner(enrichment_status)', {
        count: 'exact',
        head: true,
      })
      .eq('songs.enrichment_status', 'pending'),
  )
  hard(
    `${table} rows on pending songs = 0`,
    row.count === 0,
    `count=${row.count}`,
  )
}

// Hard: confidence stays inside [0, 1].
const lowConfidence = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .lt('ai_confidence', 0),
)
const highConfidence = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .gt('ai_confidence', 1),
)
const outOfRange = lowConfidence.count + highConfidence.count
hard(
  'ai_confidence outside [0, 1] = 0',
  outOfRange === 0,
  `count=${outOfRange}`,
)

// Hard: enrichment_model is always the provider:model_id shape.
const badModelString = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .in('enrichment_status', ['enriched', 'unknown'])
    .not('enrichment_model', 'like', '%:%'),
)
hard(
  'enriched/unknown rows with malformed enrichment_model = 0',
  badModelString.count === 0,
  `count=${badModelString.count}`,
)

// Hard: every vocabulary name is normalized (lowercase, trimmed, single
// spaces). Counts only — tag values never printed.
for (const table of ['genres', 'moods']) {
  const rows = await service.from(table).select('name')
  if (rows.error) {
    hard(`${table} names normalized`, false, `err(${rows.error.message})`)
    continue
  }
  const badNames = rows.data.filter(
    (row) => row.name !== row.name.trim().toLowerCase().replace(/\s+/g, ' '),
  ).length
  hard(`${table} names normalized`, badNames === 0, `count=${badNames}`)
}

// Hard: an anonymous client must see zero personal tag rows (RLS canary).
for (const table of ['user_genres', 'user_moods']) {
  const result = await anon
    .from(table)
    .select('song_id', { count: 'exact', head: true })
  const blocked = result.error !== null || result.count === 0
  hard(
    `anon sees 0 ${table} (RLS)`,
    blocked,
    result.error ? 'denied' : `count=${result.count}`,
  )
}

console.log('')

// Informational counts.
for (const status of ['pending', 'enriched', 'unknown']) {
  const row = await headCount(
    service
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .eq('enrichment_status', status),
  )
  console.log(`INFO  enrichment_status=${status}: ${row.count}`)
}

for (const table of [
  'genres',
  'moods',
  'song_genres',
  'song_moods',
  'user_genres',
  'user_moods',
]) {
  const row = await headCount(
    service.from(table).select('*', { count: 'exact', head: true }),
  )
  console.log(`INFO  ${table}=${row.count}`)
}

const modelRows = await service
  .from('songs')
  .select('enrichment_model')
  .not('enrichment_model', 'is', null)
  .limit(1000)
const distinctModels = new Set(
  (modelRows.data ?? []).map((row) => row.enrichment_model),
)
console.log(`INFO  distinct enrichment_model values: ${distinctModels.size}`)

const minConfidence = await service
  .from('songs')
  .select('ai_confidence')
  .not('ai_confidence', 'is', null)
  .order('ai_confidence', { ascending: true })
  .limit(1)
  .maybeSingle()
const maxConfidence = await service
  .from('songs')
  .select('ai_confidence')
  .not('ai_confidence', 'is', null)
  .order('ai_confidence', { ascending: false })
  .limit(1)
  .maybeSingle()
console.log(
  `INFO  ai_confidence range: ${minConfidence.data?.ai_confidence ?? 'n/a'} .. ${maxConfidence.data?.ai_confidence ?? 'n/a'}`,
)

console.log(
  failed
    ? '\nENRICHMENT INVARIANTS FAILED: see FAIL lines above.'
    : '\nENRICHMENT OK: all invariants hold.',
)
process.exit(failed ? 1 : 0)
