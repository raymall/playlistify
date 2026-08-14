import { generateText, Output } from 'ai'

import { resolveProviderModel } from '@/lib/ai/providers'
import {
  failedCandidate,
  normalizeCandidate,
  normalizeCandidateTagList,
  omittedCandidate,
} from '@/lib/enrichment/candidates'
import { recordAndPromoteCandidate } from '@/lib/enrichment/promotion'
import {
  type ClaimedEnrichmentJob,
  claimEnrichmentJobs,
  claimSongEnrichmentJob,
  enqueueLibraryEnrichmentJobs,
  type EnrichmentCounts,
  getLibraryEnrichmentCounts,
  isSupportedRecipe,
  releaseClaimedJobs,
} from '@/lib/enrichment/recipes'
import {
  type EnrichedSong,
  enrichmentBatchSchema,
} from '@/lib/enrichment/schema'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  matchApprovedVocabulary,
  type VocabularyResult,
} from '@/lib/vocabulary'

export type EnrichBatchPayload = {
  processedSoFar: number
}

export { type EnrichmentCounts } from '@/lib/enrichment/recipes'

export type EnrichBatchResponse =
  | ({
      status: 'progress'
      batchProcessed: number
      batchPromoted: number
      batchRejected: number
      batchOmitted: number
    } & EnrichmentCounts)
  | ({ status: 'waiting'; retryAfterMs: number } & EnrichmentCounts)
  | ({ status: 'done' } & EnrichmentCounts)
  | ({ status: 'cap_reached' } & EnrichmentCounts)
  | { status: 'error'; message: string; safeToRetry?: boolean }

export type EnrichSongPayload = {
  songId: string
}

export type EnrichSongResponse =
  /** `skipped` means nothing was queued for the song — never a billed call. */
  | { status: 'analyzed'; isPromoted: boolean }
  | { status: 'skipped' }
  | { status: 'error'; message: string; safeToRetry?: boolean }

const DEFAULT_BATCH_SIZE = 20
const MIN_BATCH_SIZE = 1
const MAX_BATCH_SIZE = 50
const DEFAULT_MAX_SONGS_PER_RUN = 500
const MIN_MAX_SONGS_PER_RUN = 1
const MAX_MAX_SONGS_PER_RUN = 5000

const SYSTEM_PROMPT = `You are a music-metadata expert. For each numbered song in the user message, return one entry in "songs" with every schema field:

- spotify_track_id: echo the id exactly as given.
- confidence: 0-1, how certain you are that you know this exact recording.
- genres (max 4) and moods (max 5): choose ONLY from the approved vocabulary lists in the user message, copying each tag verbatim. Never invent, translate, combine, or add a tag that is not on the lists — off-list tags are discarded. If nothing on a list fits, return fewer tags or none. Genres describe the musical style; moods the emotional feel.
- energy: 1 (calm) to 5 (intense).
- tempo_feel: slow, mid, or fast.
- era: the decade or scene the recording belongs to, e.g. "1990s".
- instrumentation (max 6): prominent instruments or production elements.
- descriptors (max 8): short free-form qualities, e.g. "driving", "lo-fi".

If you do not recognize a song with reasonable certainty, set confidence below 0.4, return empty arrays for genres, moods, instrumentation, and descriptors, era as an empty string, energy 1, and tempo_feel "mid". Never guess attributes for a song you do not recognize.

Return every input song exactly once — same count, same ids.`

type EnrichmentFailure = {
  status: 'error'
  message: string
  safeToRetry: boolean
}

const fail = (
  step: string,
  message: string,
  safeToRetry = false,
): EnrichmentFailure => {
  console.error(`[enrich] ${step} failed: ${message}`)
  return { status: 'error', message, safeToRetry }
}

const readEnvInt = (
  name: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const describeSong = (job: ClaimedEnrichmentJob, index: number): string => {
  const title = job.title ?? 'unknown title'
  const artists =
    job.artists !== null && job.artists.length > 0
      ? job.artists.join(', ')
      : 'unknown artist'
  const album = job.album ?? 'unknown'
  const year =
    job.releaseDate !== null ? job.releaseDate.slice(0, 4) : 'unknown'
  return `${index + 1}. ${job.spotifyTrackId} — "${title}" by ${artists} (album: ${album}, released: ${year})`
}

const buildUserPrompt = (
  jobs: ClaimedEnrichmentJob[],
  genreNames: string[],
  moodNames: string[],
): string =>
  [
    `Approved genre vocabulary (choose only from these): ${
      genreNames.join(', ') || '(none)'
    }`,
    `Approved mood vocabulary (choose only from these): ${
      moodNames.join(', ') || '(none)'
    }`,
    '',
    'Songs:',
    ...jobs.map(describeSong),
  ].join('\n')

const logUnmatchedTags = async (
  admin: ReturnType<typeof createAdminClient>,
  kind: 'genre' | 'mood',
  names: string[],
) => {
  if (names.length === 0) return
  const { error } = await admin.rpc('log_unmatched_tags', {
    p_kind: kind,
    p_names: names,
  })
  if (error !== null) {
    console.error(`[enrich] unmatched ${kind} log failed: ${error.message}`)
  }
}

const loadApprovedVocabulary = async (
  admin: ReturnType<typeof createAdminClient>,
) => {
  const [genreResult, moodResult] = await Promise.all([
    admin.from('genres').select('name').eq('is_approved', true).order('name'),
    admin.from('moods').select('name').eq('is_approved', true).order('name'),
  ])
  if (genreResult.error !== null) {
    return { status: 'error' as const, message: genreResult.error.message }
  }
  if (moodResult.error !== null) {
    return { status: 'error' as const, message: moodResult.error.message }
  }
  return {
    status: 'ok' as const,
    genreNames: genreResult.data.map((row) => row.name),
    moodNames: moodResult.data.map((row) => row.name),
  }
}

const matchCandidateVocabulary = async (
  admin: ReturnType<typeof createAdminClient>,
  entries: EnrichedSong[],
): Promise<
  | {
      status: 'ok'
      genres: Extract<VocabularyResult, { status: 'ok' }>
      moods: Extract<VocabularyResult, { status: 'ok' }>
    }
  | { status: 'error'; message: string }
> => {
  const genreNames = normalizeCandidateTagList(
    entries.flatMap((entry) => entry.genres),
  )
  const moodNames = normalizeCandidateTagList(
    entries.flatMap((entry) => entry.moods),
  )
  const [genres, moods] = await Promise.all([
    matchApprovedVocabulary(admin, 'genres', genreNames),
    matchApprovedVocabulary(admin, 'moods', moodNames),
  ])
  if (genres.status === 'error') return genres
  if (moods.status === 'error') return moods
  await Promise.all([
    logUnmatchedTags(admin, 'genre', genres.unmatched),
    logUnmatchedTags(admin, 'mood', moods.unmatched),
  ])
  return { status: 'ok', genres, moods }
}

const getCounts = async (
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<
  EnrichmentCounts | Extract<EnrichBatchResponse, { status: 'error' }>
> => {
  const result = await getLibraryEnrichmentCounts(admin, userId)
  return result.status === 'ok'
    ? result.counts
    : fail('analysis counts', result.message, true)
}

const isErrorResponse = (
  value: EnrichmentCounts | Extract<EnrichBatchResponse, { status: 'error' }>,
): value is Extract<EnrichBatchResponse, { status: 'error' }> =>
  'status' in value

const recordFailedJobs = async (
  admin: ReturnType<typeof createAdminClient>,
  jobs: ClaimedEnrichmentJob[],
) => {
  const results = await Promise.all(
    jobs.map((job) => recordAndPromoteCandidate(admin, job, failedCandidate())),
  )
  for (const result of results) {
    if (result.status === 'error') {
      console.error(`[enrich] failed-attempt write failed: ${result.message}`)
    }
  }
}

const releaseForSafeRetry = async (
  admin: ReturnType<typeof createAdminClient>,
  jobs: ClaimedEnrichmentJob[],
) => {
  const error = await releaseClaimedJobs(admin, jobs)
  if (error !== null) {
    console.error(`[enrich] safe lease release failed: ${error.message}`)
  }
}

type ClaimedRunResult =
  | { status: 'ok'; promoted: number; rejected: number; omitted: number }
  | EnrichmentFailure

/**
 * Prompt, structured-output call, vocabulary match, and promotion for one
 * claimed same-recipe batch. Shared so the single-song path cannot drift from
 * the batch path — they must bill and promote identically.
 */
const runClaimedJobs = async (
  admin: ReturnType<typeof createAdminClient>,
  jobs: ClaimedEnrichmentJob[],
  firstJob: ClaimedEnrichmentJob,
): Promise<ClaimedRunResult> => {
  if (!isSupportedRecipe(firstJob)) {
    await releaseForSafeRetry(admin, jobs)
    return fail('recipe resolution', 'Recipe version is not supported', true)
  }

  const resolvedModel = resolveProviderModel(
    firstJob.provider,
    firstJob.modelId,
  )
  if (resolvedModel.status === 'error') {
    await releaseForSafeRetry(admin, jobs)
    return fail('model resolution', resolvedModel.message, true)
  }

  const vocabulary = await loadApprovedVocabulary(admin)
  if (vocabulary.status === 'error') {
    await releaseForSafeRetry(admin, jobs)
    return fail('approved vocabulary', vocabulary.message, true)
  }

  let batch
  try {
    const result = await generateText({
      model: resolvedModel.model,
      maxRetries: 4,
      output: Output.object({ schema: enrichmentBatchSchema }),
      instructions: SYSTEM_PROMPT,
      prompt: buildUserPrompt(
        jobs,
        vocabulary.genreNames,
        vocabulary.moodNames,
      ),
      providerOptions: { openai: { reasoningEffort: 'low' } },
    })
    batch = result.output
  } catch (error) {
    console.error('[enrich]', error)
    await recordFailedJobs(admin, jobs)
    const message =
      error instanceof Error ? error.message : 'Analysis call failed'
    return { status: 'error', message, safeToRetry: false }
  }

  const jobsByTrackId = new Map(jobs.map((job) => [job.spotifyTrackId, job]))
  const entriesByTrackId = new Map<string, EnrichedSong>()
  for (const entry of batch.songs) {
    if (!jobsByTrackId.has(entry.spotify_track_id)) continue
    if (entriesByTrackId.has(entry.spotify_track_id)) continue
    entriesByTrackId.set(entry.spotify_track_id, entry)
  }

  const vocabularyMatches = await matchCandidateVocabulary(admin, [
    ...entriesByTrackId.values(),
  ])
  if (vocabularyMatches.status === 'error') {
    await recordFailedJobs(admin, jobs)
    return fail('candidate vocabulary', vocabularyMatches.message)
  }

  const outcomes = jobs.map((job) => {
    const entry = entriesByTrackId.get(job.spotifyTrackId)
    return {
      job,
      outcome:
        entry === undefined
          ? omittedCandidate()
          : normalizeCandidate(
              entry,
              vocabularyMatches.genres.canonicalByName,
              vocabularyMatches.moods.canonicalByName,
            ),
    }
  })

  const promotionResults = await Promise.all(
    outcomes.map(({ job, outcome }) =>
      recordAndPromoteCandidate(admin, job, outcome),
    ),
  )
  const failedPromotion = promotionResults.find(
    (result) => result.status === 'error',
  )
  if (failedPromotion?.status === 'error') {
    return fail('candidate promotion', failedPromotion.message)
  }

  const promoted = promotionResults.filter(
    (result) => result.status === 'ok' && result.promotion.isPromoted,
  ).length
  return {
    status: 'ok',
    promoted,
    rejected: promotionResults.length - promoted,
    omitted: outcomes.filter(({ outcome }) => outcome.outcome === 'omitted')
      .length,
  }
}

export const enrichLibraryBatch = async (
  userId: string,
  processedSoFar: number,
): Promise<EnrichBatchResponse> => {
  const batchSize = readEnvInt(
    'ENRICHMENT_BATCH_SIZE',
    DEFAULT_BATCH_SIZE,
    MIN_BATCH_SIZE,
    MAX_BATCH_SIZE,
  )
  const runCap = readEnvInt(
    'ENRICHMENT_MAX_SONGS_PER_RUN',
    DEFAULT_MAX_SONGS_PER_RUN,
    MIN_MAX_SONGS_PER_RUN,
    MAX_MAX_SONGS_PER_RUN,
  )
  const admin = createAdminClient()

  const enqueueError = await enqueueLibraryEnrichmentJobs(admin, userId)
  if (enqueueError !== null) {
    return fail('job enqueue', enqueueError.message, true)
  }

  const initialCounts = await getCounts(admin, userId)
  if (isErrorResponse(initialCounts)) return initialCounts
  if (initialCounts.eligible === 0) {
    return { status: 'done', ...initialCounts }
  }
  if (processedSoFar >= runCap) {
    return { status: 'cap_reached', ...initialCounts }
  }

  const claim = await claimEnrichmentJobs(
    admin,
    userId,
    Math.min(batchSize, runCap - processedSoFar),
  )
  if (claim.status === 'error') {
    return fail('job claim', claim.message, true)
  }
  if (claim.jobs.length === 0) {
    return initialCounts.queued > 0
      ? { status: 'waiting', retryAfterMs: 3000, ...initialCounts }
      : { status: 'done', ...initialCounts }
  }

  const firstJob = claim.jobs.at(0)
  if (
    firstJob === undefined ||
    claim.jobs.some(
      (job) =>
        job.recipeId !== firstJob.recipeId ||
        job.leaseToken !== firstJob.leaseToken,
    )
  ) {
    await releaseForSafeRetry(admin, claim.jobs)
    return fail('job claim', 'Claimed batch mixed recipes or leases', true)
  }
  const run = await runClaimedJobs(admin, claim.jobs, firstJob)
  if (run.status === 'error') return run

  const finalCounts = await getCounts(admin, userId)
  if (isErrorResponse(finalCounts)) return finalCounts

  return {
    status: 'progress',
    batchProcessed: claim.jobs.length,
    batchPromoted: run.promoted,
    batchRejected: run.rejected,
    batchOmitted: run.omitted,
    ...finalCounts,
  }
}

/**
 * Analyzes exactly one song's queued job. The row control's endpoint: same
 * recipe selection, lease, prompt, and promotion as the batch path — the only
 * difference is that the claim is narrowed to one song, so requesting one song
 * does not bill for the rest of the queue.
 */
export const enrichSong = async (
  userId: string,
  songId: string,
): Promise<EnrichSongResponse> => {
  const admin = createAdminClient()

  const claim = await claimSongEnrichmentJob(admin, userId, songId)
  if (claim.status === 'error') {
    return fail('song claim', claim.message, true)
  }
  const job = claim.jobs.at(0)
  if (job === undefined) return { status: 'skipped' }

  const run = await runClaimedJobs(admin, claim.jobs, job)
  if (run.status === 'error') return run
  return { status: 'analyzed', isPromoted: run.promoted > 0 }
}
