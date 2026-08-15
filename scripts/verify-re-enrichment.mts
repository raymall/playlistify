// Guarded re-enrichment verification: exercises the promotion matrix as pure
// policy tests, then checks remote queue/attempt/canonical and RLS invariants.
// Prints counts and ids only; never song titles, tags, or personal data.
//
// Usage: npm run verify:re-enrichment

import { createClient } from '@supabase/supabase-js'

import {
  CONFIDENCE_BAND_ORDER,
  getConfidenceBand,
} from '@/lib/enrichment/confidence'
import {
  decidePromotion,
  type PromotionCandidate,
} from '@/lib/enrichment/policy'
import { type Database, type Tables } from '@/lib/supabase/types'
import { requireEnv } from '@/scripts/lib/env.mjs'

/** Mirrors the budget in `enrichment_attempts_remaining_at_rank()`. */
const ANSWER_BUDGET_PER_RANK = 3

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
  // Medium is eligible, but only a High result may replace it — a same-band
  // re-roll would walk the Medium boundary upward without being better.
  ['medium + high', 'medium', recognized('high'), true],
  ['medium + medium', 'medium', recognized('medium'), false],
  ['medium + low', 'medium', recognized('low'), false],
  ['medium + unknown', 'medium', unknown, false],
  ['high + recognized', 'high', recognized('high'), false],
  ['high + high', 'high', recognized('high'), false],
  ['omitted candidate', 'pending', omitted, false],
  ['failed candidate', 'pending', modelFailed, false],
] as const

for (const [label, currentBand, candidate, shouldPromote] of cases) {
  const result = decidePromotion({
    currentBand,
    candidate,
    candidateRank: 200,
    activeRank: 100,
    highestAttemptedRank: 100,
    canEnrichAllSongs: false,
  })
  hard(`policy: ${label}`, result.shouldPromote === shouldPromote)
}

// The High opt-in. Without enrich_all_songs a High song is untouchable however
// strong the recipe; with it, only a stronger rank may try, and only another
// High result may land.
const highOptIn = [
  ['stronger recipe, no opt-in', 300, false, recognized('high'), 'ineligible'],
  ['same-rank recipe, opted in', 200, true, recognized('high'), 'ineligible'],
  ['stronger recipe, opted in', 300, true, recognized('high'), null],
  [
    'opted-in candidate lands medium',
    300,
    true,
    recognized('medium'),
    'would_downgrade',
  ],
  [
    'opted-in candidate lands low',
    300,
    true,
    recognized('low'),
    'would_downgrade',
  ],
  ['opted-in candidate is unknown', 300, true, unknown, 'would_downgrade'],
] as const

for (const [
  label,
  candidateRank,
  canEnrichAllSongs,
  candidate,
  refusal,
] of highOptIn) {
  const result = decidePromotion({
    currentBand: 'high',
    candidate,
    candidateRank,
    activeRank: 200,
    highestAttemptedRank: candidateRank,
    canEnrichAllSongs,
  })
  const expected = refusal ?? 'stronger_recipe'
  hard(
    `policy: high + ${label} → ${expected}`,
    result.shouldPromote === (refusal === null) && result.reason === expected,
    result.reason === expected ? '' : `got=${result.reason}`,
  )
}

// The refusals a Medium song must give, by name — "not promoted" alone would
// pass even if the wrong branch produced it.
const refusalReasons = [
  ['medium + medium', 'medium', recognized('medium'), 'not_better'],
  ['medium + low', 'medium', recognized('low'), 'would_downgrade'],
  ['medium + unknown', 'medium', unknown, 'would_downgrade'],
  ['high + high', 'high', recognized('high'), 'ineligible'],
] as const

for (const [label, currentBand, candidate, reason] of refusalReasons) {
  const result = decidePromotion({
    currentBand,
    candidate,
    candidateRank: 200,
    activeRank: 100,
    highestAttemptedRank: 100,
    canEnrichAllSongs: false,
  })
  hard(
    `policy reason: ${label} → ${reason}`,
    !result.shouldPromote && result.reason === reason,
    result.reason === reason ? '' : `got=${result.reason}`,
  )
}

const superseded = decidePromotion({
  currentBand: 'low',
  candidate: recognized('high'),
  candidateRank: 200,
  activeRank: 100,
  highestAttemptedRank: 300,
  canEnrichAllSongs: false,
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
    'id, song_id, recipe_rank, outcome, confidence, decision, decision_reason, decided_at, genre_names, mood_names',
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

  // The answer budget, read back off the log it is derived from. Only
  // recognized/unknown consume it; omissions and failures have their own lane
  // in song_enrichment_jobs.attempt_count.
  const answersByRank = new Map<string, number>()
  for (const attempt of attemptResult.data) {
    if (attempt.outcome !== 'recognized' && attempt.outcome !== 'unknown') {
      continue
    }
    const key = `${attempt.song_id}:${attempt.recipe_rank}`
    answersByRank.set(key, (answersByRank.get(key) ?? 0) + 1)
  }
  const overBudget = [...answersByRank.entries()].filter(
    ([, count]) => count > ANSWER_BUDGET_PER_RANK,
  )
  hard(
    `no song exceeds ${ANSWER_BUDGET_PER_RANK} answers at one recipe rank`,
    overBudget.length === 0,
    `overBudget=${overBudget.length} ranks=${answersByRank.size}`,
  )

  // Promotion may never move a song down a band, so the promoted attempts of
  // one song read in decision order are non-decreasing.
  const promotedBySong = new Map<
    string,
    { decidedAt: string; rank: number }[]
  >()
  for (const attempt of attemptResult.data) {
    if (attempt.decision !== 'promoted' || attempt.decided_at === null) continue
    const band =
      attempt.outcome === 'unknown'
        ? 'none'
        : getConfidenceBand('enriched', attempt.confidence)
    const promoted = promotedBySong.get(attempt.song_id) ?? []
    promoted.push({
      decidedAt: attempt.decided_at,
      rank: CONFIDENCE_BAND_ORDER.indexOf(band),
    })
    promotedBySong.set(attempt.song_id, promoted)
  }
  let regressions = 0
  for (const promoted of promotedBySong.values()) {
    promoted.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
    for (let index = 1; index < promoted.length; index += 1) {
      if (promoted[index].rank < promoted[index - 1].rank) regressions += 1
    }
  }
  hard(
    'promoted bands never regress for a song',
    regressions === 0,
    `regressions=${regressions} songs=${promotedBySong.size}`,
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
