// One-time reset for the approved-vocabulary cutover: clears every AI tag
// link + enrichment column on enriched songs (back to 'pending') so the
// closed-vocabulary engine can re-enrich them, and deletes unapproved
// vocabulary rows nothing references anymore.
//
// It also clears each reset song's jobs and attempts, which is not optional.
// The three-answers-per-rank budget is derived from song_enrichment_attempts
// and the omission allowance lives on song_enrichment_jobs, so a song set back
// to 'pending' while either survives is locked the moment it is reset: its
// budget reads as spent and a terminally failed job excludes its recipe.
//
// Personal tags are never rewritten. They are free-form by policy, so an
// unapproved vocabulary row a user linked is that user's tag, exactly as they
// typed it — not a near-miss to be corrected onto an approved name. Only
// unapproved rows with zero personal links are collected.
//
// Never touches user_songs, songs metadata, the status of 'unknown' songs, or
// any personal tag link (stale AI links found on non-enriched songs are
// cleared — unknown songs must carry no tags). Everything it deletes is
// regenerable by re-running enrichment. Prints counts only, never song or user
// values.
//
// Dry-run report by default; pass --apply to execute.
//
// Usage: node --env-file=.env.local --import tsx scripts/reset-enrichment.mts [--apply]
import { createClient } from '@supabase/supabase-js'

import { fetchWithRetries } from '../lib/supabase/fetch'
import type { Database } from '../lib/supabase/types'
import { requireEnv } from './lib/env.mjs'

const isApply = process.argv.includes('--apply')

/** `songs.enrichment_rank` for a row no recipe has written yet. */
const NEVER_ENRICHED_RANK = 0

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

// Retry fetch: the chunked delete loop makes enough requests that undici's
// transient "fetch failed" is a matter of when, not if.
const service = createClient<Database>(url, serviceKey, {
  global: { fetch: fetchWithRetries },
})

const abort = (message: string): never => {
  console.error(`ABORT ${message}`)
  process.exit(1)
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** PostgREST caps a select at 1000 rows — page until short. */
const fetchEnrichedSongIds = async () => {
  const ids: string[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const page = await service
      .from('songs')
      .select('id')
      .eq('enrichment_status', 'enriched')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (page.error) abort(`enriched song ids: ${page.error.message}`)
    else {
      ids.push(...page.data.map((row) => row.id))
      if (page.data.length < pageSize) return ids
    }
  }
}

const countRows = async (table: 'song_genres' | 'song_moods') => {
  const result = await service
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (result.error) abort(`${table} count: ${result.error.message}`)
  return result.count ?? 0
}

/** `.in()` over the full id list would exceed the URL limit — count in chunks. */
const countForSongs = async (
  table: 'song_enrichment_jobs' | 'song_enrichment_attempts',
  ids: string[],
) => {
  let total = 0
  for (const batch of chunk(ids, 100)) {
    const result = await service
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in('song_id', batch)
    if (result.error) abort(`${table} count: ${result.error.message}`)
    total += result.count ?? 0
  }
  return total
}

// ── Approved vocabulary guard ────────────────────────────────────────────

const approvedNamesOf = async (table: 'genres' | 'moods') => {
  const result = await service
    .from(table)
    .select('name')
    .eq('is_approved', true)
  if (result.error) abort(`approved ${table}: ${result.error.message}`)
  return (result.data ?? []).map((row) => row.name)
}

const approvedGenres = await approvedNamesOf('genres')
const approvedMoods = await approvedNamesOf('moods')
if (approvedGenres.length === 0 || approvedMoods.length === 0) {
  abort('approved vocabulary is empty — run the seed migration first')
}

// ── Report ───────────────────────────────────────────────────────────────

const enrichedIds = await fetchEnrichedSongIds()
const aiGenreLinks = await countRows('song_genres')
const aiMoodLinks = await countRows('song_moods')

// AI links normally sit only on enriched songs (links land right before the
// status flip). Links on a non-enriched song are stale residue — a crashed
// batch wrote links, then a retry marked the song 'unknown' — and unknown
// songs must carry no tags, so those get cleared too.
const staleLinkScan = async (table: 'song_genres' | 'song_moods') => {
  const rows = await service
    .from(table)
    .select('song_id, songs!inner(enrichment_status)')
    .neq('songs.enrichment_status', 'enriched')
  if (rows.error) abort(`${table} stale scan: ${rows.error.message}`)
  const data = rows.data ?? []
  return {
    links: data.length,
    songIds: [...new Set(data.map((r) => r.song_id))],
  }
}

const staleGenres = await staleLinkScan('song_genres')
const staleMoods = await staleLinkScan('song_moods')
const jobsToClear = await countForSongs('song_enrichment_jobs', enrichedIds)
const attemptsToClear = await countForSongs(
  'song_enrichment_attempts',
  enrichedIds,
)

type UserLinkPlan = {
  /** Distinct unapproved vocab ids a personal link still points at. */
  keptVocabIds: Set<string>
  /** Links on an unapproved row — free-form personal tags, all kept. */
  keptLinks: number
  total: number
  onApproved: number
}

/**
 * Which unapproved vocabulary rows a personal link still holds open. Every
 * such link is kept — a free-form tag is the user's own word, and the only
 * reason to look at all is so the cleanup below cannot delete a row out from
 * under one.
 */
const planUserGenreLinks = async (): Promise<UserLinkPlan> => {
  const links = await service
    .from('user_genres')
    .select('genre_id, genres!inner(is_approved)')
  if (links.error) abort(`user_genres read: ${links.error.message}`)
  const plan: UserLinkPlan = {
    keptVocabIds: new Set(),
    keptLinks: 0,
    total: 0,
    onApproved: 0,
  }
  for (const link of links.data ?? []) {
    plan.total += 1
    if (link.genres.is_approved) {
      plan.onApproved += 1
      continue
    }
    plan.keptVocabIds.add(link.genre_id)
    plan.keptLinks += 1
  }
  return plan
}

const planUserMoodLinks = async (): Promise<UserLinkPlan> => {
  const links = await service
    .from('user_moods')
    .select('mood_id, moods!inner(is_approved)')
  if (links.error) abort(`user_moods read: ${links.error.message}`)
  const plan: UserLinkPlan = {
    keptVocabIds: new Set(),
    keptLinks: 0,
    total: 0,
    onApproved: 0,
  }
  for (const link of links.data ?? []) {
    plan.total += 1
    if (link.moods.is_approved) {
      plan.onApproved += 1
      continue
    }
    plan.keptVocabIds.add(link.mood_id)
    plan.keptLinks += 1
  }
  return plan
}

const genrePlan = await planUserGenreLinks()
const moodPlan = await planUserMoodLinks()

const unapprovedIdsOf = async (table: 'genres' | 'moods') => {
  const result = await service.from(table).select('id').eq('is_approved', false)
  if (result.error) abort(`unapproved ${table}: ${result.error.message}`)
  return (result.data ?? []).map((row) => row.id)
}

const unapprovedGenreIds = await unapprovedIdsOf('genres')
const unapprovedMoodIds = await unapprovedIdsOf('moods')
const deletableGenres = unapprovedGenreIds.filter(
  (id) => !genrePlan.keptVocabIds.has(id),
)
const deletableMoods = unapprovedMoodIds.filter(
  (id) => !moodPlan.keptVocabIds.has(id),
)

console.log(isApply ? 'APPLY' : 'REPORT (dry run — pass --apply to execute)')
console.log(
  `  approved vocabulary: genres=${approvedGenres.length} moods=${approvedMoods.length}`,
)
console.log(`  songs to reset (enriched → pending): ${enrichedIds.length}`)
console.log(
  `  ai genre links to delete: ${aiGenreLinks} (${staleGenres.links} stale on non-enriched songs)`,
)
console.log(
  `  ai mood links to delete: ${aiMoodLinks} (${staleMoods.links} stale on non-enriched songs)`,
)
console.log(
  `  queue rows to delete: jobs=${jobsToClear} attempts=${attemptsToClear}`,
)
for (const [label, plan] of [
  ['user genre links', genrePlan],
  ['user mood links', moodPlan],
] as const) {
  console.log(
    `  ${label}: total=${plan.total} on-approved=${plan.onApproved} kept-free-form=${plan.keptLinks}`,
  )
}
console.log(
  `  unapproved genres: ${unapprovedGenreIds.length} — delete ${deletableGenres.length}, keep ${genrePlan.keptVocabIds.size} (user-referenced)`,
)
console.log(
  `  unapproved moods: ${unapprovedMoodIds.length} — delete ${deletableMoods.length}, keep ${moodPlan.keptVocabIds.size} (user-referenced)`,
)

if (!isApply) {
  console.log('\nDRY RUN ONLY: nothing was changed.')
  process.exit(0)
}

// ── Apply ────────────────────────────────────────────────────────────────

// 1. AI links first: their songs are about to go back to pending. Stale
// link song ids ride along so the invariant (non-enriched → no tags) holds.
for (const [table, staleIds] of [
  ['song_genres', staleGenres.songIds],
  ['song_moods', staleMoods.songIds],
] as const) {
  for (const ids of chunk([...enrichedIds, ...staleIds], 100)) {
    const removed = await service.from(table).delete().in('song_id', ids)
    if (removed.error) abort(`${table} delete: ${removed.error.message}`)
  }
  console.log(`DONE  ${table} cleared`)
}

// 2. The queue history. Attempts are where the three-answers-per-rank budget
// is counted from, and a job left `failed` excludes its recipe permanently —
// so a song reset to pending on top of either is locked before it is ever
// offered.
//
// This goes through purge_song_enrichment_history rather than a plain delete:
// song_enrichment_attempts is append-only by trigger, so a direct
// `.delete()` aborts, and the RPC is the one place the trigger yields. It also
// detaches the two ON DELETE RESTRICT references in the same transaction as
// the delete, which a client-side sequence cannot promise.
let purgedAttempts = 0
let purgedJobs = 0
for (const ids of chunk(enrichedIds, 100)) {
  const purged = await service.rpc('purge_song_enrichment_history', {
    p_song_ids: ids,
  })
  if (purged.error) abort(`queue purge: ${purged.error.message}`)
  else {
    const row = purged.data.at(0)
    purgedAttempts += row?.attempts_deleted ?? 0
    purgedJobs += row?.jobs_deleted ?? 0
  }
}
console.log(
  `DONE  queue history purged (attempts=${purgedAttempts}, jobs=${purgedJobs})`,
)

// 3. Enriched songs back to pending with every enrichment column cleared. Both
// ranks go to zero: a row left at a non-zero enrichment_rank contradicts the
// column's "0 = never enriched" meaning, and a stale
// highest_attempted_recipe_rank would keep the selector from ever offering
// this supposedly-fresh song a recipe below it.
const reset = await service
  .from('songs')
  .update({
    ai_confidence: null,
    ai_attributes: null,
    enrichment_status: 'pending',
    enrichment_model: null,
    enrichment_rank: NEVER_ENRICHED_RANK,
    highest_attempted_recipe_rank: NEVER_ENRICHED_RANK,
    enriched_at: null,
  })
  .eq('enrichment_status', 'enriched')
if (reset.error) abort(`songs reset: ${reset.error.message}`)
console.log(`DONE  ${enrichedIds.length} songs reset to pending`)

// 4. Unapproved vocabulary rows nothing references anymore. Zero-reference
// only, so the FK cascade never eats a free-form tag someone is still using.
if (deletableGenres.length > 0) {
  const removed = await service
    .from('genres')
    .delete()
    .in('id', deletableGenres)
  if (removed.error) abort(`genres cleanup: ${removed.error.message}`)
}
if (deletableMoods.length > 0) {
  const removed = await service.from('moods').delete().in('id', deletableMoods)
  if (removed.error) abort(`moods cleanup: ${removed.error.message}`)
}
console.log(
  `DONE  unapproved vocabulary deleted (genres=${deletableGenres.length}, moods=${deletableMoods.length})`,
)

// ── Post-apply verification ──────────────────────────────────────────────

const pendingAfter = await service
  .from('songs')
  .select('id', { count: 'exact', head: true })
  .eq('enrichment_status', 'pending')
const unknownAfter = await service
  .from('songs')
  .select('id', { count: 'exact', head: true })
  .eq('enrichment_status', 'unknown')
if (pendingAfter.error !== null || unknownAfter.error !== null) {
  abort('post-apply recount failed')
}
console.log(
  `\nRESET OK: pending=${pendingAfter.count} unknown=${unknownAfter.count} ` +
    `ai_genre_links=${await countRows('song_genres')} ` +
    `ai_mood_links=${await countRows('song_moods')} ` +
    `jobs=${await countForSongs('song_enrichment_jobs', enrichedIds)} ` +
    `attempts=${await countForSongs('song_enrichment_attempts', enrichedIds)}`,
)
