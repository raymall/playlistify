// Enrichment verification: asserts the invariants the LLM enrichment pipeline
// guarantees, then prints informational counts. Prints counts only, never
// song or tag values.
//
// Usage: node --env-file=.env.local scripts/verify-enrichment.mjs
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

// Mirrored from lib/enrichment/confidence.ts — this script is .mjs and cannot
// import TS. Same convention as CONFIDENCE_THRESHOLD.
const LOW_MAX_CONFIDENCE = 0.5
const MEDIUM_MAX_CONFIDENCE = 0.75

const { hard, hasFailed } = createChecker()

// Hard: enriched rows carry the full enrichment column set; unknown rows
// carry confidence/model/timestamp (ai_attributes intentionally stays null,
// hence the shorter list).
for (const [status, columns] of [
  [
    'enriched',
    ['ai_confidence', 'enrichment_model', 'enriched_at', 'ai_attributes'],
  ],
  ['unknown', ['ai_confidence', 'enrichment_model', 'enriched_at']],
]) {
  for (const column of columns) {
    const row = await headCount(
      service
        .from('songs')
        .select('id', { count: 'exact', head: true })
        .eq('enrichment_status', status)
        .is(column, null),
    )
    hard(
      `${status} rows with null ${column} = 0`,
      row.count === 0,
      `count=${row.count}`,
    )
  }
}

// Hard: unknown rows carry no AI output. Unknown = confidence below the
// threshold OR the model's zero-tag placeholder shape, so confidence alone
// is deliberately NOT asserted — attributes and links are.
const unknownWithAttributes = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .eq('enrichment_status', 'unknown')
    .not('ai_attributes', 'is', null),
)
hard(
  'unknown rows with ai_attributes set = 0',
  unknownWithAttributes.count === 0,
  `count=${unknownWithAttributes.count}`,
)

// Hard: pending rows carry no enrichment output. Covers all four nullable
// enrichment columns, so a writer that resets a song to 'pending' without
// clearing everything it owns fails here instead of silently.
for (const column of [
  'enriched_at',
  'ai_attributes',
  'ai_confidence',
  'enrichment_model',
]) {
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

// Hard: a pending row has never been successfully written, so it must sit at
// rank 0 — the column's "never enriched" value. A non-zero rank here means a
// reset cleared the visible columns but left the rank behind.
const pendingWithRank = await headCount(
  service
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .eq('enrichment_status', 'pending')
    .neq('enrichment_rank', 0),
)
hard(
  'pending rows with a non-zero enrichment_rank = 0',
  pendingWithRank.count === 0,
  `count=${pendingWithRank.count}`,
)

// Hard: AI tag links exist only on enriched songs.
for (const table of ['song_genres', 'song_moods']) {
  const row = await headCount(
    service
      .from(table)
      .select('song_id, songs!inner(enrichment_status)', {
        count: 'exact',
        head: true,
      })
      .neq('songs.enrichment_status', 'enriched'),
  )
  hard(
    `${table} rows on non-enriched songs = 0`,
    row.count === 0,
    `count=${row.count}`,
  )
}

// Hard: every enriched song carries at least one AI tag link — the engine
// classifies a zero-tag result as unknown (placeholder guard), so an
// enriched-but-tagless song means that guard leaked.
{
  const pageSize = 1000
  let zeroTag = 0
  let checked = 0
  for (let from = 0; ; from += pageSize) {
    const page = await service
      .from('songs')
      .select('id, song_genres(genre_id), song_moods(mood_id)')
      .eq('enrichment_status', 'enriched')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (page.error) {
      hard(
        'enriched rows with zero AI tags = 0',
        false,
        `err(${page.error.message})`,
      )
      break
    }
    checked += page.data.length
    zeroTag += page.data.filter(
      (row) => row.song_genres.length === 0 && row.song_moods.length === 0,
    ).length
    if (page.data.length < pageSize) {
      hard(
        'enriched rows with zero AI tags = 0',
        zeroTag === 0,
        `count=${zeroTag} of ${checked}`,
      )
      break
    }
  }
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

// Songs the selector has stopped sending, and those partway to it. The
// omission allowance lives on the job now, so a growing retired count means a
// model is repeatedly dropping songs from its response.
{
  const [retired, counting] = await Promise.all([
    headCount(
      service
        .from('song_enrichment_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
    ),
    headCount(
      service
        .from('song_enrichment_jobs')
        .select('id', { count: 'exact', head: true })
        .gt('attempt_count', 0)
        .neq('status', 'failed'),
    ),
  ])
  console.log(
    `INFO  omissions: retired jobs=${retired.count} mid-count=${counting.count}`,
  )
}

// Confidence distribution (lib/enrichment/confidence.ts). Pending and None
// come from status; only enriched rows are split by confidence.
{
  const enriched = () =>
    service
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .eq('enrichment_status', 'enriched')
  const [pending, none, lowScored, lowNull, medium, high] = await Promise.all([
    headCount(
      service
        .from('songs')
        .select('id', { count: 'exact', head: true })
        .eq('enrichment_status', 'pending'),
    ),
    headCount(
      service
        .from('songs')
        .select('id', { count: 'exact', head: true })
        .eq('enrichment_status', 'unknown'),
    ),
    headCount(enriched().lte('ai_confidence', LOW_MAX_CONFIDENCE)),
    headCount(enriched().is('ai_confidence', null)),
    headCount(
      enriched()
        .gt('ai_confidence', LOW_MAX_CONFIDENCE)
        .lte('ai_confidence', MEDIUM_MAX_CONFIDENCE),
    ),
    headCount(enriched().gt('ai_confidence', MEDIUM_MAX_CONFIDENCE)),
  ])
  console.log(
    `INFO  confidence bands: pending=${pending.count} none=${none.count} ` +
      `low=${lowScored.count + lowNull.count} medium=${medium.count} high=${high.count}`,
  )
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
  hasFailed()
    ? '\nENRICHMENT INVARIANTS FAILED: see FAIL lines above.'
    : '\nENRICHMENT OK: all invariants hold.',
)
process.exit(hasFailed() ? 1 : 0)
