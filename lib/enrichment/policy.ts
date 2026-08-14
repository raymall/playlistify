import {
  CONFIDENCE_BAND_ORDER,
  type ConfidenceBand,
} from '@/lib/enrichment/confidence'

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

const bandRank = (band: ConfidenceBand) => CONFIDENCE_BAND_ORDER.indexOf(band)

/**
 * Mirrors the promotion chain in `public.promote_song_enrichment_attempt()`,
 * which is the authority — this runs first so a candidate that could never be
 * promoted is not billed. Two carve-outs aside, promotion is one ordinal
 * comparison over `CONFIDENCE_BAND_ORDER`, so a band added later needs no new
 * branch: a Medium song accepting only a High result holds by construction.
 */
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
  if (currentBand === 'high') {
    return { shouldPromote: false, reason: 'ineligible' }
  }
  // Nothing to lose: a pending song holds no result at all.
  if (currentBand === 'pending') {
    return candidate.outcome === 'unknown'
      ? { shouldPromote: true, reason: 'initial_unknown' }
      : { shouldPromote: true, reason: 'initial_recognized' }
  }
  // No tags to lose: None and a recognized-but-weak result share a band, yet
  // recognition is still the better of the two.
  if (currentBand === 'none' && candidate.outcome === 'recognized') {
    return { shouldPromote: true, reason: 'recognized_after_unknown' }
  }
  const currentBandRank = bandRank(currentBand)
  const candidateBandRank = bandRank(candidate.band)
  if (candidateBandRank > currentBandRank) {
    return { shouldPromote: true, reason: 'improved_band' }
  }
  if (candidateBandRank < currentBandRank) {
    return { shouldPromote: false, reason: 'would_downgrade' }
  }
  // Same band, including a higher confidence within it — promoting on that
  // would be a max-of-N re-roll that inflates every band's lower boundary.
  return { shouldPromote: false, reason: 'not_better' }
}
