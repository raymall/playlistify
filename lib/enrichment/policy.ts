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
  /** `songs.enrichment_rank` — the rank that produced the result on the row. */
  activeRank: number
  highestAttemptedRank: number
  /** The candidate recipe's `enrich_all_songs`. */
  canEnrichAllSongs: boolean
}

export type PromotionPolicyDecision = {
  shouldPromote: boolean
  reason:
    | 'initial_recognized'
    | 'initial_unknown'
    | 'recognized_after_unknown'
    | 'improved_band'
    | 'stronger_recipe'
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
 * which is the sole authority — nothing calls this before billing. It exists
 * so `verify:re-enrichment` can exercise the matrix as pure cases, which means
 * the two must be edited together or the tests certify the wrong rule.
 *
 * Two carve-outs and the High opt-in aside, promotion is one ordinal
 * comparison over `CONFIDENCE_BAND_ORDER`, so a band added later needs no new
 * branch: a Medium song accepting only a High result holds by construction.
 */
export const decidePromotion = ({
  currentBand,
  candidate,
  candidateRank,
  activeRank,
  highestAttemptedRank,
  canEnrichAllSongs,
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
  // High is finished unless the candidate's recipe opted in and genuinely
  // outranks the one that produced the result being replaced — and even then,
  // only another High result may take its place.
  if (currentBand === 'high') {
    if (!canEnrichAllSongs || candidateRank <= activeRank) {
      return { shouldPromote: false, reason: 'ineligible' }
    }
    return candidate.outcome === 'recognized' && candidate.band === 'high'
      ? { shouldPromote: true, reason: 'stronger_recipe' }
      : { shouldPromote: false, reason: 'would_downgrade' }
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
