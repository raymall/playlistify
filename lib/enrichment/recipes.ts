import { randomUUID } from 'node:crypto'

import { type SupabaseClient } from '@supabase/supabase-js'

import { isKnownIdentityField } from '@/lib/enrichment/identity'
import { readEnrichmentOutputSpec } from '@/lib/enrichment/schema'
import { type Database } from '@/lib/supabase/types'

type AdminClient = SupabaseClient<Database>

export type EnrichmentCounts = {
  total: number
  pending: number
  none: number
  low: number
  medium: number
  high: number
  queued: number
  ineligibleWeak: number
  eligible: number
}

/**
 * A recipe as the Library reports it: everything that makes one analysis
 * different from another, so what is being paid for is legible rather than
 * inferred from the model name.
 */
export type EnrichmentRecipeSummary = {
  recipeId: string
  label: string
  provider: string
  modelId: string
  reasoningEffort: string
  batchSize: number
  enrichmentRank: number
  /** Hash of the complete snapshot — prompt, identity, spec, vocabulary. */
  contentHash: string
  canEnrichAllSongs: boolean
  isCurrent: boolean
  /** Songs the next run would send here instead of the current recipe. */
  escalatingSongs: number
}

/**
 * The current recipe plus any escalation, on the caller's RLS client — the
 * catalog itself is unreadable to it, so this goes through the reporting RPC.
 */
export const getLibraryEnrichmentRecipes = async (
  supabase: SupabaseClient<Database>,
): Promise<EnrichmentRecipeSummary[]> => {
  const { data, error } = await supabase.rpc('library_enrichment_recipes')
  if (error !== null) {
    console.error(`[library] recipe report failed: ${error.message}`)
    return []
  }
  return data.map((row) => ({
    recipeId: row.recipe_id,
    label: row.label,
    provider: row.provider,
    modelId: row.model_id,
    reasoningEffort: row.reasoning_effort,
    batchSize: row.batch_size,
    enrichmentRank: row.enrichment_rank,
    contentHash: row.content_hash,
    canEnrichAllSongs: row.enrich_all_songs,
    isCurrent: row.is_current,
    escalatingSongs: row.escalating_songs,
  }))
}

export type ClaimedEnrichmentJob = {
  jobId: string
  leaseToken: string
  recipeId: string
  spotifyTrackId: string
  title: string | null
  artists: string[] | null
  album: string | null
  releaseDate: string | null
  provider: string
  modelId: string
  reasoningEffort: string
  systemPrompt: string
  identityFields: string[]
  outputSpec: unknown
  genreNames: string[]
  moodNames: string[]
}

export const enqueueLibraryEnrichmentJobs = async (
  admin: AdminClient,
  userId: string,
) => {
  const retried = await admin.rpc('retry_failed_enrichment_jobs', {
    p_user_id: userId,
  })
  if (retried.error !== null) return retried.error
  const retired = await admin.rpc('retire_disabled_enrichment_jobs', {
    p_user_id: userId,
  })
  if (retired.error !== null) return retired.error
  const { error } = await admin.rpc('enqueue_library_enrichment_jobs', {
    p_user_id: userId,
  })
  return error
}

export const getLibraryEnrichmentCounts = async (
  admin: AdminClient,
  userId: string,
): Promise<
  | { status: 'ok'; counts: EnrichmentCounts }
  | { status: 'error'; message: string }
> => {
  const { data, error } = await admin.rpc('get_library_enrichment_counts', {
    p_user_id: userId,
  })
  if (error !== null) return { status: 'error', message: error.message }
  const row = data.at(0)
  if (row === undefined) {
    return { status: 'error', message: 'Analysis counts were unavailable' }
  }
  return {
    status: 'ok',
    counts: {
      total: row.total,
      pending: row.pending,
      none: row.none,
      low: row.low,
      medium: row.medium,
      high: row.high,
      queued: row.queued,
      ineligibleWeak: row.ineligible_weak,
      eligible: row.eligible,
    },
  }
}

type ClaimedJobRow = {
  job_id: string
  lease_token: string
  recipe_id: string
  spotify_track_id: string
  title: string | null
  artists: string[] | null
  album: string | null
  release_date: string | null
  provider: string
  model_id: string
  reasoning_effort: string
  system_prompt: string
  identity_fields: string[]
  output_spec: unknown
  genre_names: string[]
  mood_names: string[]
}

const readClaimedJob = (row: ClaimedJobRow): ClaimedEnrichmentJob => ({
  jobId: row.job_id,
  leaseToken: row.lease_token,
  recipeId: row.recipe_id,
  spotifyTrackId: row.spotify_track_id,
  title: row.title,
  artists: row.artists,
  album: row.album,
  releaseDate: row.release_date,
  provider: row.provider,
  modelId: row.model_id,
  reasoningEffort: row.reasoning_effort,
  systemPrompt: row.system_prompt,
  identityFields: row.identity_fields,
  outputSpec: row.output_spec,
  genreNames: row.genre_names,
  moodNames: row.mood_names,
})

export const claimEnrichmentJobs = async (
  admin: AdminClient,
  userId: string,
  limit: number,
): Promise<
  | { status: 'ok'; jobs: ClaimedEnrichmentJob[] }
  | { status: 'error'; message: string }
> => {
  const leaseToken = randomUUID()
  const { data, error } = await admin.rpc('claim_song_enrichment_jobs', {
    p_user_id: userId,
    p_limit: limit,
    p_lease_seconds: 600,
    p_lease_token: leaseToken,
  })
  if (error !== null) return { status: 'error', message: error.message }
  return { status: 'ok', jobs: data.map(readClaimedJob) }
}

/**
 * Capability check over the claimed snapshot, not a version-literal match:
 * the prompt is present, the output spec parses into the bounded shape this
 * build understands, and every identity field has a formatter. A recipe this
 * build cannot execute faithfully is released unclaimed rather than guessed
 * at. Provider and effort get the same treatment in the engine, through
 * `resolveProviderModel` / `resolveProviderEffortOptions`.
 */
export const isSupportedRecipe = (job: ClaimedEnrichmentJob): boolean =>
  job.systemPrompt.trim() !== '' &&
  readEnrichmentOutputSpec(job.outputSpec) !== null &&
  job.identityFields.length > 0 &&
  job.identityFields.every(isKnownIdentityField)

export const releaseClaimedJobs = async (
  admin: AdminClient,
  jobs: ClaimedEnrichmentJob[],
) => {
  const firstJob = jobs.at(0)
  if (firstJob === undefined) return null
  const { error } = await admin.rpc('release_song_enrichment_jobs', {
    p_job_ids: jobs.map((job) => job.jobId),
    p_lease_token: firstJob.leaseToken,
  })
  return error
}
