import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Tables } from '@/lib/supabase/types'

export type LlmModel = Tables<'llm_models'>

/**
 * Enabled rows of the admin-curated model catalog, in dropdown order.
 * An empty list is the designed "enrichment unavailable" state, not an
 * error — the admin disabled everything in Supabase Studio. Null means the
 * query itself failed (e.g. Supabase unreachable) — callers must not treat
 * that as "no models enabled".
 */
export const getEnabledModels = async (
  supabase: SupabaseClient<Database>,
): Promise<LlmModel[] | null> => {
  const { data, error } = await supabase
    .from('llm_models')
    .select('*')
    .eq('enabled', true)
    .order('sort_order')
    .order('label')
  if (error !== null) {
    console.error('[models] llm_models query failed:', error.message)
    return null
  }
  return data
}

/** The is_default row, else the first enabled row (admin cleared the default). */
export const getDefaultModel = (models: LlmModel[]) =>
  models.find((model) => model.is_default) ?? models.at(0) ?? null

/**
 * Resolves a client-submitted row id against the enabled rows — the client
 * never names a billable model string directly. Null means reject with 400.
 */
export const findEnabledModel = (models: LlmModel[], id: string) =>
  models.find((model) => model.id === id) ?? null

/** Value recorded in songs.enrichment_model, e.g. 'openai:gpt-5.4-mini'. */
export const toEnrichmentModelString = (model: LlmModel) =>
  `${model.provider}:${model.model_id}`
