// Guarded re-enrichment verification: exercises the promotion matrix as pure
// policy tests, then checks remote queue/attempt/canonical and RLS invariants.
// Prints counts and ids only; never song titles, tags, or personal data.
//
// Usage: npm run verify:re-enrichment

import { createClient } from '@supabase/supabase-js'

import {
  decidePromotion,
  type PromotionCandidate,
} from '@/lib/enrichment/policy'
import { type Database, type Tables } from '@/lib/supabase/types'
import { requireEnv } from '@/scripts/lib/env.mjs'

const [url, anonKey, serviceKey] = requireEnv([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
])

const service = createClient<Database>(url, serviceKey)
const anon = createClient<Database>(url, anonKey)
let failureCount = 0

const hard = (label: string, isPassing: boolean, detail = '') => {
  if (!isPassing) failureCount += 1
  console.log(
    `${isPassing ? 'PASS' : 'FAIL'}  ${label}${detail.length > 0 ? `  ${detail}` : ''}`,
  )
}

const recognized = (band: 'low' | 'medium' | 'high'): PromotionCandidate => ({
  outcome: 'recognized',
  band,
})

const unknown: PromotionCandidate = { outcome: 'unknown', band: 'none' }
const omitted: PromotionCandidate = { outcome: 'omitted', band: 'none' }
const modelFailed: PromotionCandidate = { outcome: 'failed', band: 'none' }

const cases = [
  ['pending + recognized', 'pending', recognized('low'), true],
  ['pending + unknown', 'pending', unknown, true],
  ['none + low', 'none', recognized('low'), true],
  ['none + medium', 'none', recognized('medium'), true],
  ['none + unknown', 'none', unknown, false],
  ['low + low', 'low', recognized('low'), false],
  ['low + unknown', 'low', unknown, false],
  ['low + medium', 'low', recognized('medium'), true],
  ['low + high', 'low', recognized('high'), true],
  ['medium + high', 'medium', recognized('high'), false],
  ['high + recognized', 'high', recognized('high'), false],
  ['omitted candidate', 'pending', omitted, false],
  ['failed candidate', 'pending', modelFailed, false],
] as const

for (const [label, currentBand, candidate, shouldPromote] of cases) {
  const result = decidePromotion({
    currentBand,
    candidate,
    candidateRank: 200,
    highestAttemptedRank: 100,
  })
  hard(`policy: ${label}`, result.shouldPromote === shouldPromote)
}

const superseded = decidePromotion({
  currentBand: 'low',
  candidate: recognized('high'),
  candidateRank: 200,
  highestAttemptedRank: 300,
})
hard(
  'policy: weaker reverse-order candidate is superseded',
  !superseded.shouldPromote && superseded.reason === 'superseded',
)

for (const table of [
  'enrichment_recipes',
  'song_enrichment_attempts',
  'song_enrichment_jobs',
  'enrichment_recheck_limits',
  'user_genre_suppressions',
  'user_mood_suppressions',
] as const) {
  const result = await anon
    .from(table)
    .select('*', { count: 'exact', head: true })
  const isBlocked = result.error !== null || result.count === 0
  hard(
    `anon sees 0 ${table}`,
    isBlocked,
    result.error === null ? `count=${result.count ?? 0}` : 'denied',
  )
}

const recipeResult = await service
  .from('enrichment_recipes')
  .select('id, enabled, is_default')
if (recipeResult.error !== null) {
  hard('recipe catalog is readable', false, recipeResult.error.message)
} else {
  const defaults = recipeResult.data.filter((recipe) => recipe.is_default)
  hard(
    'at most one enabled default recipe',
    defaults.length <= 1 && defaults.every((recipe) => recipe.enabled),
    `defaults=${defaults.length}`,
  )
}

const jobResult = await service
  .from('song_enrichment_jobs')
  .select(
    'id, status, attempt_count, lease_token, lease_expires_at, expected_revision',
  )
if (jobResult.error !== null) {
  hard('job lease shapes are valid', false, jobResult.error.message)
} else {
  const invalidJobs = jobResult.data.filter((job) => {
    const hasLease =
      job.lease_token !== null &&
      job.lease_expires_at !== null &&
      job.expected_revision !== null
    return (
      (job.status === 'leased') !== hasLease ||
      job.attempt_count < 0 ||
      job.attempt_count > 3
    )
  })
  hard(
    'job lease shapes and attempt caps are valid',
    invalidJobs.length === 0,
    `invalid=${invalidJobs.length} jobs=${jobResult.data.length}`,
  )
}

const attemptResult = await service
  .from('song_enrichment_attempts')
  .select(
    'id, song_id, outcome, decision, decision_reason, decided_at, genre_names, mood_names',
  )
if (attemptResult.error !== null) {
  hard('attempt decisions are valid', false, attemptResult.error.message)
} else {
  const invalidAttempts = attemptResult.data.filter((attempt) =>
    attempt.decision === 'pending'
      ? attempt.decision_reason !== null || attempt.decided_at !== null
      : attempt.decision_reason === null || attempt.decided_at === null,
  )
  hard(
    'attempt decision shapes are valid',
    invalidAttempts.length === 0,
    `invalid=${invalidAttempts.length} attempts=${attemptResult.data.length}`,
  )
}

const songsResult = await service.from('songs').select(
  `id, enrichment_rank, highest_attempted_recipe_rank,
     active_enrichment_attempt_id,
     song_genres(genres(name)),
     song_moods(moods(name))`,
)
if (songsResult.error !== null) {
  hard(
    'canonical attempt snapshots are valid',
    false,
    songsResult.error.message,
  )
} else {
  const rankRegressions = songsResult.data.filter(
    (song) => song.highest_attempted_recipe_rank < song.enrichment_rank,
  )
  hard(
    'highest attempted rank never trails active rank',
    rankRegressions.length === 0,
    `invalid=${rankRegressions.length}`,
  )

  const activeIds = songsResult.data.flatMap((song) =>
    song.active_enrichment_attempt_id === null
      ? []
      : [song.active_enrichment_attempt_id],
  )
  let activeAttempts: Pick<
    Tables<'song_enrichment_attempts'>,
    'id' | 'song_id' | 'outcome' | 'decision' | 'genre_names' | 'mood_names'
  >[] = []
  let activeAttemptsError: string | null = null
  if (activeIds.length > 0) {
    const result = await service
      .from('song_enrichment_attempts')
      .select('id, song_id, outcome, decision, genre_names, mood_names')
      .in('id', activeIds)
    activeAttempts = result.data ?? []
    activeAttemptsError = result.error?.message ?? null
  }
  if (activeAttemptsError !== null) {
    hard('active attempts are promoted', false, activeAttemptsError)
  } else {
    const attemptById = new Map(
      activeAttempts.map((attempt) => [attempt.id, attempt]),
    )
    let invalidActive = 0
    let staleSnapshots = 0
    for (const song of songsResult.data) {
      if (song.active_enrichment_attempt_id === null) continue
      const attempt = attemptById.get(song.active_enrichment_attempt_id)
      if (attempt?.decision !== 'promoted') {
        invalidActive += 1
        continue
      }
      if (attempt.outcome !== 'recognized') continue
      const canonicalGenres = song.song_genres
        .map((link) => link.genres.name)
        .sort()
      const canonicalMoods = song.song_moods
        .map((link) => link.moods.name)
        .sort()
      if (
        canonicalGenres.join('\n') !==
          [...attempt.genre_names].sort().join('\n') ||
        canonicalMoods.join('\n') !== [...attempt.mood_names].sort().join('\n')
      ) {
        staleSnapshots += 1
      }
    }
    hard(
      'every active attempt is promoted',
      invalidActive === 0,
      `invalid=${invalidActive}`,
    )
    hard(
      'promoted AI tags exactly equal the candidate snapshot',
      staleSnapshots === 0,
      `invalid=${staleSnapshots}`,
    )
  }
}

console.log(
  failureCount > 0
    ? '\nRE-ENRICHMENT INVARIANTS FAILED: see FAIL lines above.'
    : '\nRE-ENRICHMENT OK: policy and remote invariants hold.',
)
process.exit(failureCount > 0 ? 1 : 0)
