// One-time reset for the approved-vocabulary cutover: clears every AI tag
// link + enrichment column on enriched songs (back to 'pending') so the
// closed-vocabulary engine can re-enrich them, re-points personal tags on
// unapproved vocabulary rows onto their approved canonical where one snaps,
// and deletes unapproved vocabulary rows nothing references anymore.
//
// Never touches user_songs, songs metadata, the status of 'unknown' songs,
// or any personal tag it cannot confidently remap (stale AI links found on
// non-enriched songs are cleared — unknown songs must carry no tags).
// Everything it deletes is regenerable by re-running enrichment. Prints
// counts only, never song or user values.
//
// Dry-run report by default; pass --apply to execute.
//
// Usage: node --env-file=.env.local --import tsx scripts/reset-enrichment.mts [--apply]
import { createClient } from '@supabase/supabase-js'

import { NO_RANK } from '../lib/enrichment/rank'
import { fetchWithRetries } from '../lib/supabase/fetch'
import type { Database } from '../lib/supabase/types'
import { snapToExistingName } from '../lib/vocabulary'
import { requireEnv } from './lib/env.mjs'

const isApply = process.argv.includes('--apply')

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

interface UserLinkPlan {
  /** Links whose row snaps onto an approved name: old id → new id. */
  remaps: { userId: string; songId: string; fromId: string; toId: string }[]
  /** Distinct unapproved vocab ids that stay referenced (snap failed). */
  keptVocabIds: Set<string>
  /** Links staying on an unapproved row (snap failed — user's own tag). */
  keptLinks: number
  total: number
  onApproved: number
}

const planUserGenreLinks = async (): Promise<UserLinkPlan> => {
  const links = await service
    .from('user_genres')
    .select('user_id, song_id, genre_id, genres!inner(name, is_approved)')
  if (links.error) abort(`user_genres read: ${links.error.message}`)
  const approvedIdByName = new Map<string, string>()
  const approvedRows = await service
    .from('genres')
    .select('id, name')
    .eq('is_approved', true)
  if (approvedRows.error) abort(`genres read: ${approvedRows.error.message}`)
  for (const row of approvedRows.data ?? []) {
    approvedIdByName.set(row.name, row.id)
  }
  const plan: UserLinkPlan = {
    remaps: [],
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
    const canonical = snapToExistingName(link.genres.name, approvedGenres)
    const toId =
      canonical === null ? undefined : approvedIdByName.get(canonical)
    if (toId === undefined) {
      plan.keptVocabIds.add(link.genre_id)
      plan.keptLinks += 1
    } else {
      plan.remaps.push({
        userId: link.user_id,
        songId: link.song_id,
        fromId: link.genre_id,
        toId,
      })
    }
  }
  return plan
}

const planUserMoodLinks = async (): Promise<UserLinkPlan> => {
  const links = await service
    .from('user_moods')
    .select('user_id, song_id, mood_id, moods!inner(name, is_approved)')
  if (links.error) abort(`user_moods read: ${links.error.message}`)
  const approvedIdByName = new Map<string, string>()
  const approvedRows = await service
    .from('moods')
    .select('id, name')
    .eq('is_approved', true)
  if (approvedRows.error) abort(`moods read: ${approvedRows.error.message}`)
  for (const row of approvedRows.data ?? []) {
    approvedIdByName.set(row.name, row.id)
  }
  const plan: UserLinkPlan = {
    remaps: [],
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
    const canonical = snapToExistingName(link.moods.name, approvedMoods)
    const toId =
      canonical === null ? undefined : approvedIdByName.get(canonical)
    if (toId === undefined) {
      plan.keptVocabIds.add(link.mood_id)
      plan.keptLinks += 1
    } else {
      plan.remaps.push({
        userId: link.user_id,
        songId: link.song_id,
        fromId: link.mood_id,
        toId,
      })
    }
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
for (const [label, plan] of [
  ['user genre links', genrePlan],
  ['user mood links', moodPlan],
] as const) {
  console.log(
    `  ${label}: total=${plan.total} on-approved=${plan.onApproved} remap=${plan.remaps.length} kept-unapproved=${plan.keptLinks}`,
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

// 2. Enriched songs back to pending with every enrichment column cleared —
// all eight, not just the visible five. A row left at a non-zero
// enrichment_rank contradicts the column's "0 = never enriched" meaning, and a
// stale enrichment_skipped_rank would silently keep the selector from ever
// sending this supposedly-fresh song to a weaker model again.
const reset = await service
  .from('songs')
  .update({
    ai_confidence: null,
    ai_attributes: null,
    enrichment_status: 'pending',
    enrichment_model: null,
    enrichment_rank: NO_RANK,
    enrichment_attempts: 0,
    enrichment_skipped_rank: NO_RANK,
    enriched_at: null,
  })
  .eq('enrichment_status', 'enriched')
if (reset.error) abort(`songs reset: ${reset.error.message}`)
console.log(`DONE  ${enrichedIds.length} songs reset to pending`)

// 3. Re-point personal tags whose row snapped onto an approved canonical.
for (const remap of genrePlan.remaps) {
  const moved = await service
    .from('user_genres')
    .upsert(
      { user_id: remap.userId, song_id: remap.songId, genre_id: remap.toId },
      { onConflict: 'user_id,song_id,genre_id', ignoreDuplicates: true },
    )
  if (moved.error) abort(`user_genres remap: ${moved.error.message}`)
  const dropped = await service
    .from('user_genres')
    .delete()
    .eq('user_id', remap.userId)
    .eq('song_id', remap.songId)
    .eq('genre_id', remap.fromId)
  if (dropped.error) abort(`user_genres old link: ${dropped.error.message}`)
}
for (const remap of moodPlan.remaps) {
  const moved = await service
    .from('user_moods')
    .upsert(
      { user_id: remap.userId, song_id: remap.songId, mood_id: remap.toId },
      { onConflict: 'user_id,song_id,mood_id', ignoreDuplicates: true },
    )
  if (moved.error) abort(`user_moods remap: ${moved.error.message}`)
  const dropped = await service
    .from('user_moods')
    .delete()
    .eq('user_id', remap.userId)
    .eq('song_id', remap.songId)
    .eq('mood_id', remap.fromId)
  if (dropped.error) abort(`user_moods old link: ${dropped.error.message}`)
}
console.log(
  `DONE  personal tags remapped (genres=${genrePlan.remaps.length}, moods=${moodPlan.remaps.length})`,
)

// 4. Unapproved vocabulary rows nothing references anymore. Zero-reference
// only, so the FK cascade never eats a link this script chose to keep.
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
  `\nRESET OK: pending=${pendingAfter.count} unknown=${unknownAfter.count} ai_genre_links=${await countRows('song_genres')} ai_mood_links=${await countRows('song_moods')}`,
)
