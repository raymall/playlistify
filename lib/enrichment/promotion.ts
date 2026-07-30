import { type SupabaseClient } from '@supabase/supabase-js'

import { type CandidateOutcome } from '@/lib/enrichment/candidates'
import { type ClaimedEnrichmentJob } from '@/lib/enrichment/recipes'
import { type Database, type Json } from '@/lib/supabase/types'

type AdminClient = SupabaseClient<Database>

export type PromotionResult = {
  decision: 'promoted' | 'rejected'
  reason: string
  isPromoted: boolean
}

const readDecision = (value: string): 'promoted' | 'rejected' | null =>
  value === 'promoted' || value === 'rejected' ? value : null

const toAttributesJson = (outcome: CandidateOutcome): Json | undefined => {
  if (outcome.aiAttributes === null) return undefined
  return {
    energy: outcome.aiAttributes.energy,
    tempo_feel: outcome.aiAttributes.tempo_feel,
    era: outcome.aiAttributes.era,
    instrumentation: outcome.aiAttributes.instrumentation,
    descriptors: outcome.aiAttributes.descriptors,
  }
}

export const recordAndPromoteCandidate = async (
  admin: AdminClient,
  job: ClaimedEnrichmentJob,
  outcome: CandidateOutcome,
): Promise<
  | { status: 'ok'; promotion: PromotionResult }
  | { status: 'error'; message: string }
> => {
  const confidenceText =
    outcome.confidence === null ? undefined : String(outcome.confidence)
  const { data: attemptId, error: recordError } = await admin.rpc(
    'record_song_enrichment_outcome',
    {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_outcome: outcome.outcome,
      p_confidence_text: confidenceText,
      p_ai_attributes: toAttributesJson(outcome),
      p_genre_names: outcome.genreNames,
      p_mood_names: outcome.moodNames,
    },
  )
  if (recordError !== null) {
    return { status: 'error', message: recordError.message }
  }

  const { data, error } = await admin.rpc('promote_song_enrichment_attempt', {
    p_attempt_id: attemptId,
    p_job_id: job.jobId,
    p_lease_token: job.leaseToken,
  })
  if (error !== null) {
    if (error.message.includes('stale enrichment lease')) {
      const cleanup = await admin.rpc('reject_stale_song_enrichment_attempt', {
        p_attempt_id: attemptId,
        p_job_id: job.jobId,
        p_lease_token: job.leaseToken,
      })
      if (cleanup.error !== null) {
        console.error(
          `[enrich] stale-attempt cleanup failed: ${cleanup.error.message}`,
        )
      }
    }
    return { status: 'error', message: error.message }
  }
  const row = data.at(0)
  if (row === undefined) {
    return { status: 'error', message: 'Promotion returned no decision' }
  }
  const decision = readDecision(row.decision)
  if (decision === null) {
    return {
      status: 'error',
      message: 'Promotion returned an invalid decision',
    }
  }
  return {
    status: 'ok',
    promotion: {
      decision,
      reason: row.reason,
      isPromoted: row.is_promoted,
    },
  }
}
