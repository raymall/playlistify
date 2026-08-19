/**
 * Shared recipe-snapshot hashing and loading for sync-recipes /
 * verify-recipes. The hash definitions here are the single source of truth:
 * the database stores their outputs (vocabulary_snapshots.content_hash,
 * enrichment_recipes.content_hash) and never recomputes them, so both scripts
 * must go through these helpers for the hashes to mean anything.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { type SupabaseClient } from '@supabase/supabase-js'

import { isRecord } from '@/lib/json'
import { type Database } from '@/lib/supabase/types'

/**
 * Deterministic JSON: object keys sorted by code unit (never locale), arrays
 * kept in given order. Throws on values JSON cannot round-trip, because a
 * silently-coerced value would hash two different snapshots as one.
 */
export const canonicalize = (value: unknown): string => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Non-finite number in a hash payload')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`
  }
  if (isRecord(value)) {
    const body = Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(',')
    return `{${body}}`
  }
  throw new Error(`Unhashable ${typeof value} in a hash payload`)
}

export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text).digest('hex')

/** Trimmed prompt file text, resolved from the repo root (npm run cwd). */
export const readPromptText = (promptFile: string): string =>
  readFileSync(resolve(process.cwd(), promptFile), 'utf8').trim()

export const computeVocabularyHash = (
  genreNames: string[],
  moodNames: string[],
): string =>
  sha256Hex(canonicalize({ genre_names: genreNames, mood_names: moodNames }))

export type RecipeHashPayload = {
  provider: string
  modelId: string
  reasoningEffort: string
  batchSize: number
  systemPrompt: string
  identityFields: string[]
  outputSpec: unknown
  enrichmentRank: number
  enrichAllSongs: boolean
  vocabularyHash: string
}

export const computeRecipeContentHash = (payload: RecipeHashPayload): string =>
  sha256Hex(
    canonicalize({
      provider: payload.provider,
      model_id: payload.modelId,
      reasoning_effort: payload.reasoningEffort,
      batch_size: payload.batchSize,
      system_prompt: payload.systemPrompt,
      identity_fields: payload.identityFields,
      output_spec: payload.outputSpec,
      enrichment_rank: payload.enrichmentRank,
      enrich_all_songs: payload.enrichAllSongs,
      vocabulary_hash: payload.vocabularyHash,
    }),
  )

export const RECIPE_KEY_HASH_LENGTH = 12

export const buildRecipeKey = (key: string, contentHash: string): string =>
  `${key}:${contentHash.slice(0, RECIPE_KEY_HASH_LENGTH)}`

const fetchApprovedNames = async (
  service: SupabaseClient<Database>,
  table: 'genres' | 'moods',
): Promise<string[]> => {
  const pageSize = 1000
  const names: string[] = []
  for (let from = 0; ; from += pageSize) {
    const page = await service
      .from(table)
      .select('name')
      .eq('is_approved', true)
      .order('name')
      .range(from, from + pageSize - 1)
    if (page.error !== null) {
      throw new Error(`approved ${table} read failed: ${page.error.message}`)
    }
    names.push(...page.data.map((row) => row.name))
    if (page.data.length < pageSize) break
  }
  return names.sort()
}

/** Live approved vocabulary, code-unit sorted for a deterministic hash. */
export const loadApprovedVocabulary = async (
  service: SupabaseClient<Database>,
) => {
  const [genreNames, moodNames] = await Promise.all([
    fetchApprovedNames(service, 'genres'),
    fetchApprovedNames(service, 'moods'),
  ])
  return {
    genreNames,
    moodNames,
    contentHash: computeVocabularyHash(genreNames, moodNames),
  }
}
