import { randomUUID } from 'node:crypto'

import { type SupabaseClient } from '@supabase/supabase-js'

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

export type ClaimedEnrichmentJob = {
  jobId: string
  leaseToken: string
  songId: string
  recipeId: string
  expectedRevision: number
  spotifyTrackId: string
  title: string | null
  artists: string[] | null
  album: string | null
  releaseDate: string | null
  provider: string
  modelId: string
  recipeRank: number
  promptVersion: string
  vocabularyVersion: string
  identityVersion: string
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

/** Both claim RPCs return the same row shape, so they share one reader. */
type ClaimedJobRow = {
  job_id: string
  lease_token: string
  song_id: string
  recipe_id: string
  expected_revision: number
  spotify_track_id: string
  title: string | null
  artists: string[] | null
  album: string | null
  release_date: string | null
  provider: string
  model_id: string
  recipe_rank: number
  prompt_version: string
  vocabulary_version: string
  identity_version: string
}

const readClaimedJob = (row: ClaimedJobRow): ClaimedEnrichmentJob => ({
  jobId: row.job_id,
  leaseToken: row.lease_token,
  songId: row.song_id,
  recipeId: row.recipe_id,
  expectedRevision: row.expected_revision,
  spotifyTrackId: row.spotify_track_id,
  title: row.title,
  artists: row.artists,
  album: row.album,
  releaseDate: row.release_date,
  provider: row.provider,
  modelId: row.model_id,
  recipeRank: row.recipe_rank,
  promptVersion: row.prompt_version,
  vocabularyVersion: row.vocabulary_version,
  identityVersion: row.identity_version,
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
 * Both generations run on this code path: the approved lists are read from the
 * database per batch, so a vocabulary revision changes the prompt's contents
 * without changing how the prompt is built. A recipe naming an unknown version
 * is released unclaimed rather than guessed at.
 */
const SUPPORTED_VOCABULARY_VERSIONS = new Set([
  'vocabulary-v1',
  'vocabulary-v2',
])

/**
 * Claims the one queued job for a single song. Same lease-token replay and
 * eligibility rules as the batch claim; it only narrows the selection, so a
 * per-row request can be analyzed without draining the whole queue.
 */
export const claimSongEnrichmentJob = async (
  admin: AdminClient,
  userId: string,
  songId: string,
): Promise<
  | { status: 'ok'; jobs: ClaimedEnrichmentJob[] }
  | { status: 'error'; message: string }
> => {
  const leaseToken = randomUUID()
  const { data, error } = await admin.rpc('claim_song_enrichment_job', {
    p_user_id: userId,
    p_song_id: songId,
    p_lease_seconds: 600,
    p_lease_token: leaseToken,
  })
  if (error !== null) return { status: 'error', message: error.message }
  return { status: 'ok', jobs: data.map(readClaimedJob) }
}

export const isSupportedRecipe = (job: ClaimedEnrichmentJob): boolean =>
  job.promptVersion === 'prompt-v1' &&
  SUPPORTED_VOCABULARY_VERSIONS.has(job.vocabularyVersion) &&
  job.identityVersion === 'identity-v1'

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

export type RecheckRequestResult =
  'queued' | 'already_queued' | 'analyzing' | 'throttled' | 'no_better_recipe'

const readRecheckRequestResult = (
  value: string,
): RecheckRequestResult | null => {
  switch (value) {
    case 'queued':
    case 'already_queued':
    case 'analyzing':
    case 'throttled':
    case 'no_better_recipe':
      return value
    default:
      return null
  }
}

export const requestSongRecheck = async (
  admin: AdminClient,
  userId: string,
  songId: string,
): Promise<
  | { status: 'ok'; result: RecheckRequestResult }
  | { status: 'error'; message: string }
> => {
  const { data, error } = await admin.rpc('request_song_enrichment_recheck', {
    p_user_id: userId,
    p_song_id: songId,
  })
  if (error !== null) return { status: 'error', message: error.message }
  const result = readRecheckRequestResult(data)
  if (result === null) {
    return { status: 'error', message: 'Unexpected recheck state' }
  }
  return { status: 'ok', result }
}
