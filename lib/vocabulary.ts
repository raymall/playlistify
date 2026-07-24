// Shared genres/moods vocabulary: tag-name normalization, fuzzy snapping of
// near-duplicate spellings onto existing rows, and name→id resolution. Two
// paths: matchApprovedVocabulary (closed, approved rows only — enrichment
// engine, admin client) and ensureVocabularyIds (open, inserts new names —
// lib/tags.ts personal tags, RLS client).

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'

export const MAX_TAG_LENGTH = 64

/**
 * The app-side dedup key for the shared vocabulary: `genres`/`moods` names
 * are unique case-sensitively in the DB, so every write and lookup must
 * normalize first.
 */
export const normalizeTagName = (raw: string): string =>
  raw.trim().toLowerCase().replace(/\s+/g, ' ')

/** Valid length for an already-normalized tag name. */
export const isValidTagName = (name: string): boolean =>
  name.length > 0 && name.length <= MAX_TAG_LENGTH

/**
 * Below this length a name is never fuzzy-merged — short tags (`rap`/`trap`,
 * `pop`, `rock`) are one edit apart yet genuinely distinct. The
 * space-insensitive check is exempt because it is exact.
 */
export const FUZZY_MIN_LENGTH = 6

/**
 * Minimum trigram (Dice) similarity to snap a new name onto an existing one.
 * Precision-first: validated against the live vocabulary so real near-pairs
 * (`reggae`/`reggaeton` ~0.71, `latin pop`/`latin rock` ~0.55) stay below it
 * while misspellings (`dominic dembow`→`dominican dembow` ~0.81) clear it. See
 * scripts/verify-genres.mts.
 */
export const FUZZY_THRESHOLD = 0.75

/** Padded character trigrams, pg_trgm-style (2 leading + 1 trailing space). */
const trigrams = (value: string): Set<string> => {
  const padded = `  ${value} `
  const set = new Set<string>()
  for (let i = 0; i < padded.length - 2; i += 1) {
    set.add(padded.slice(i, i + 3))
  }
  return set
}

/** Dice coefficient over character trigrams — 1 identical, 0 disjoint. */
export const trigramSimilarity = (a: string, b: string): number => {
  if (a === b) return 1
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const gram of ta) {
    if (tb.has(gram)) shared += 1
  }
  return (2 * shared) / (ta.size + tb.size)
}

const stripSpaces = (value: string): string => value.replace(/ /g, '')

/**
 * Snap a normalized candidate onto an existing vocabulary name, or return
 * null when it is genuinely new. Order: exact → space-insensitive exact
 * (`dem bow`→`dembow`) → best trigram match above threshold. Assumes both the
 * candidate and `existingNames` are already normalized.
 */
export const snapToExistingName = (
  name: string,
  existingNames: string[],
): string | null => {
  const despaced = stripSpaces(name)
  let bestFuzzy: string | null = null
  let bestScore = 0
  for (const existing of existingNames) {
    if (existing === name) return existing
    if (stripSpaces(existing) === despaced) return existing
    if (name.length < FUZZY_MIN_LENGTH || existing.length < FUZZY_MIN_LENGTH) {
      continue
    }
    const score = trigramSimilarity(name, existing)
    if (score > bestScore) {
      bestScore = score
      bestFuzzy = existing
    }
  }
  return bestScore >= FUZZY_THRESHOLD ? bestFuzzy : null
}

export type VocabularyTable = 'genres' | 'moods'

export type VocabularyResult =
  | {
      status: 'ok'
      /** input name → id of the resolved (canonical) vocabulary row. */
      idsByName: Map<string, string>
      /** input name → the resolved (canonical) name it snapped to. */
      canonicalByName: Map<string, string>
    }
  | { status: 'error'; message: string }

/**
 * Resolves normalized tag names to vocabulary row ids, snapping near-duplicate
 * spellings onto the existing vocabulary and inserting only genuinely new
 * names. Insert-ignore-duplicates then select — the one write pattern legal
 * under both the RLS client (no UPDATE policy on the vocabulary tables) and
 * the admin client. `names` must already be normalized and deduped.
 */
export type ApprovedMatchResult =
  | {
      status: 'ok'
      /** input name → id of the approved row it resolved to. */
      idsByName: Map<string, string>
      /** input name → the approved canonical name it snapped to. */
      canonicalByName: Map<string, string>
      /** input names that matched no approved row (for review logging). */
      unmatched: string[]
    }
  | { status: 'error'; message: string }

/**
 * Resolves normalized tag names against the **approved** vocabulary only —
 * same snapping order as ensureVocabularyIds (exact → space-insensitive →
 * trigram), but closed: nothing is ever inserted, and names that match no
 * approved row come back in `unmatched`. Enrichment path; personal tags keep
 * the open ensureVocabularyIds path below.
 */
export const matchApprovedVocabulary = async (
  client: SupabaseClient<Database>,
  table: VocabularyTable,
  names: string[],
): Promise<ApprovedMatchResult> => {
  if (names.length === 0) {
    return {
      status: 'ok',
      idsByName: new Map(),
      canonicalByName: new Map(),
      unmatched: [],
    }
  }

  const approved = await client
    .from(table)
    .select('id, name')
    .eq('is_approved', true)
  if (approved.error) {
    return { status: 'error', message: approved.error.message }
  }
  const idByName = new Map(approved.data.map((row) => [row.name, row.id]))
  const approvedNames = approved.data.map((row) => row.name)

  const idsByName = new Map<string, string>()
  const canonicalByName = new Map<string, string>()
  const unmatched: string[] = []
  for (const name of names) {
    const canonical = snapToExistingName(name, approvedNames)
    const id = canonical === null ? undefined : idByName.get(canonical)
    if (canonical === null || id === undefined) {
      unmatched.push(name)
      continue
    }
    idsByName.set(name, id)
    canonicalByName.set(name, canonical)
  }
  return { status: 'ok', idsByName, canonicalByName, unmatched }
}

export const ensureVocabularyIds = async (
  client: SupabaseClient<Database>,
  table: VocabularyTable,
  names: string[],
): Promise<VocabularyResult> => {
  if (names.length === 0) {
    return { status: 'ok', idsByName: new Map(), canonicalByName: new Map() }
  }

  // Load the current vocabulary so new names can snap onto existing spellings.
  const existing = await client.from(table).select('id, name')
  if (existing.error) {
    return { status: 'error', message: existing.error.message }
  }
  const idByName = new Map(existing.data.map((row) => [row.name, row.id]))
  const existingNames = existing.data.map((row) => row.name)

  // Resolve every input to a canonical name (existing match or itself).
  const canonicalByName = new Map<string, string>()
  const toInsert = new Set<string>()
  for (const name of names) {
    const canonical = snapToExistingName(name, existingNames) ?? name
    canonicalByName.set(name, canonical)
    if (!idByName.has(canonical)) toInsert.add(canonical)
  }

  if (toInsert.size > 0) {
    const newNames = [...toInsert]
    const inserted = await client.from(table).upsert(
      newNames.map((name) => ({ name })),
      { onConflict: 'name', ignoreDuplicates: true },
    )
    if (inserted.error) {
      return { status: 'error', message: inserted.error.message }
    }
    const selected = await client
      .from(table)
      .select('id, name')
      .in('name', newNames)
    if (selected.error) {
      return { status: 'error', message: selected.error.message }
    }
    for (const row of selected.data) idByName.set(row.name, row.id)
  }

  const idsByName = new Map<string, string>()
  for (const [name, canonical] of canonicalByName) {
    const id = idByName.get(canonical)
    if (id !== undefined) idsByName.set(name, id)
  }
  return { status: 'ok', idsByName, canonicalByName }
}
