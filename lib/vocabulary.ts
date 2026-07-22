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

export type VocabularyTable = 'genres' | 'moods'

export type VocabularyResult =
  | { status: 'ok'; idsByName: Map<string, string> }
  | { status: 'error'; message: string }

/**
 * Resolves normalized tag names to vocabulary row ids, inserting missing
 * names. Insert-ignore-duplicates then select — the one write pattern legal
 * under both the RLS client (no UPDATE policy on the vocabulary tables) and
 * the admin client. `names` must already be normalized and deduped.
 */
export const ensureVocabularyIds = async (
  client: SupabaseClient<Database>,
  table: VocabularyTable,
  names: string[],
): Promise<VocabularyResult> => {
  if (names.length === 0) return { status: 'ok', idsByName: new Map() }

  const inserted = await client.from(table).upsert(
    names.map((name) => ({ name })),
    { onConflict: 'name', ignoreDuplicates: true },
  )
  if (inserted.error) {
    return { status: 'error', message: inserted.error.message }
  }

  const selected = await client.from(table).select('id, name').in('name', names)
  if (selected.error) {
    return { status: 'error', message: selected.error.message }
  }

  const idsByName = new Map<string, string>()
  for (const row of selected.data) idsByName.set(row.name, row.id)
  return { status: 'ok', idsByName }
}
