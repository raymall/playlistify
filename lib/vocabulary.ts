// Shared genres/moods vocabulary: tag-name normalization, validation, and
// name→id resolution. Matching is exact on the normalized name — there is no
// fuzzy or near-duplicate snapping, so a name is either already in the
// vocabulary or it is genuinely new. Two paths with opposite policies:
// matchApprovedVocabulary (CLOSED — enrichment engine, admin client: approved
// rows only, nothing inserted, off-list names dropped) and ensureVocabularyIds
// (OPEN — lib/tags.ts personal tags, RLS client: whatever the user typed is
// accepted, inserting an is_approved=false row when it is new).

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'

export const MAX_TAG_LENGTH = 64

/**
 * The app-side dedup key for the shared vocabulary: `genres`/`moods` names
 * are unique case-sensitively in the DB, so every write and lookup must
 * normalize first. This is the only transformation applied to a personal tag —
 * it exists for the unique constraint, not to police what the user may type.
 */
export const normalizeTagName = (raw: string): string =>
  raw.trim().toLowerCase().replace(/\s+/g, ' ')

/** Valid length for an already-normalized tag name. */
export const isValidTagName = (name: string): boolean =>
  name.length > 0 && name.length <= MAX_TAG_LENGTH

export type VocabularyTable = 'genres' | 'moods'

export type ApprovedMatchResult =
  | {
      status: 'ok'
      /** input names that exactly matched an approved row. */
      matched: string[]
      /** input names that matched no approved row (for review logging). */
      unmatched: string[]
    }
  | { status: 'error'; message: string }

/**
 * Partitions normalized tag names against the **approved** vocabulary: closed,
 * exact, and read-only. Nothing is ever inserted and nothing is rewritten — a
 * name the model returned that is not on the approved list lands in
 * `unmatched`, which the engine logs to `unmatched_tags`. Ids are deliberately
 * not returned: `promote_song_enrichment_attempt` resolves approved names to
 * ids itself, in the same transaction that writes the links.
 *
 * Personal tags take the open ensureVocabularyIds path below instead.
 */
export const matchApprovedVocabulary = async (
  client: SupabaseClient<Database>,
  table: VocabularyTable,
  names: string[],
): Promise<ApprovedMatchResult> => {
  if (names.length === 0) {
    return { status: 'ok', matched: [], unmatched: [] }
  }

  // Scoped to the requested names rather than loading the whole approved list:
  // no full-table transfer, and no exposure to the 1,000-row response ceiling
  // as the vocabulary grows. A claimed batch is capped at 50 songs, so this
  // list stays small enough to ride in the query string.
  const approved = await client
    .from(table)
    .select('name')
    .eq('is_approved', true)
    .in('name', names)
  if (approved.error) {
    return { status: 'error', message: approved.error.message }
  }
  const approvedNames = new Set(approved.data.map((row) => row.name))

  const matched: string[] = []
  const unmatched: string[] = []
  for (const name of names) {
    if (approvedNames.has(name)) matched.push(name)
    else unmatched.push(name)
  }
  return { status: 'ok', matched, unmatched }
}

export type VocabularyResult =
  | {
      status: 'ok'
      /** input name → id of the vocabulary row it resolved to. */
      idsByName: Map<string, string>
    }
  | { status: 'error'; message: string }

/**
 * Resolves normalized tag names to vocabulary row ids, inserting any name that
 * is not already there. Open by design: the user's own tags are free-form, so
 * a genuinely new name becomes a new `is_approved = false` row rather than
 * being snapped onto something that merely looks similar.
 *
 * Insert-ignore-duplicates then select — the one write pattern legal under
 * both the RLS client (no UPDATE policy on the vocabulary tables) and the
 * admin client. `names` must already be normalized and deduped.
 */
export const ensureVocabularyIds = async (
  client: SupabaseClient<Database>,
  table: VocabularyTable,
  names: string[],
): Promise<VocabularyResult> => {
  if (names.length === 0) {
    return { status: 'ok', idsByName: new Map() }
  }

  const existing = await client.from(table).select('id, name').in('name', names)
  if (existing.error) {
    return { status: 'error', message: existing.error.message }
  }
  const idsByName = new Map(existing.data.map((row) => [row.name, row.id]))

  const toInsert = names.filter((name) => !idsByName.has(name))
  if (toInsert.length > 0) {
    const inserted = await client.from(table).upsert(
      toInsert.map((name) => ({ name })),
      { onConflict: 'name', ignoreDuplicates: true },
    )
    if (inserted.error) {
      return { status: 'error', message: inserted.error.message }
    }
    const selected = await client
      .from(table)
      .select('id, name')
      .in('name', toInsert)
    if (selected.error) {
      return { status: 'error', message: selected.error.message }
    }
    for (const row of selected.data) idsByName.set(row.name, row.id)
  }

  return { status: 'ok', idsByName }
}
