import { type ConfidenceBand } from '@/lib/enrichment/confidence'

export type PromotionCandidate =
  | { outcome: 'recognized'; band: 'low' | 'medium' | 'high' }
  | { outcome: 'unknown' | 'omitted' | 'failed'; band: 'none' }

export type PromotionPolicyInput = {
  currentBand: ConfidenceBand
  candidate: PromotionCandidate
  candidateRank: number
  highestAttemptedRank: number
}

export type PromotionPolicyDecision = {
  shouldPromote: boolean
  reason:
    | 'initial_recognized'
    | 'initial_unknown'
    | 'recognized_after_unknown'
    | 'improved_band'
    | 'not_better'
    | 'would_downgrade'
    | 'ineligible'
    | 'superseded'
    | 'omitted'
    | 'failed'
}

export const decidePromotion = ({
  currentBand,
  candidate,
  candidateRank,
  highestAttemptedRank,
}: PromotionPolicyInput): PromotionPolicyDecision => {
  if (candidate.outcome === 'omitted') {
    return { shouldPromote: false, reason: 'omitted' }
  }
  if (candidate.outcome === 'failed') {
    return { shouldPromote: false, reason: 'failed' }
  }
  if (candidateRank < highestAttemptedRank) {
    return { shouldPromote: false, reason: 'superseded' }
  }
  if (currentBand === 'medium' || currentBand === 'high') {
    return { shouldPromote: false, reason: 'ineligible' }
  }
  if (currentBand === 'pending') {
    return candidate.outcome === 'unknown'
      ? { shouldPromote: true, reason: 'initial_unknown' }
      : { shouldPromote: true, reason: 'initial_recognized' }
  }
  if (currentBand === 'none') {
    return candidate.outcome === 'recognized'
      ? { shouldPromote: true, reason: 'recognized_after_unknown' }
      : { shouldPromote: false, reason: 'not_better' }
  }
  if (candidate.outcome === 'unknown') {
    return { shouldPromote: false, reason: 'would_downgrade' }
  }
  if (candidate.band === 'medium' || candidate.band === 'high') {
    return { shouldPromote: true, reason: 'improved_band' }
  }
  return { shouldPromote: false, reason: 'not_better' }
}
