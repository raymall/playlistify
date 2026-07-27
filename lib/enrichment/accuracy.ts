// Accuracy: the user-facing reading of a song's enrichment result. Derived,
// never stored, so it cannot desync from enrichment_status/ai_confidence.
// Client-safe — no server imports. The two cuts below are the single source
// for the table, the info popover, and (mirrored as literals) the
// verify:enrichment band distribution.

/** Top of the Low band, inclusive. Also the re-enrichment eligibility line. */
export const LOW_MAX_CONFIDENCE = 0.5

/** Top of the Medium band, inclusive. */
export const MEDIUM_MAX_CONFIDENCE = 0.75

export type AccuracyBand = 'pending' | 'none' | 'low' | 'medium' | 'high'

/** Display order: statuses first, then the scored bands weakest to strongest. */
export const ACCURACY_BAND_ORDER = [
  'pending',
  'none',
  'low',
  'medium',
  'high',
] as const

/**
 * Pending and None come from the status; only `enriched` rows are scored.
 *
 * The bands are total and gap-free because `ai_confidence` is `numeric(3,2)` —
 * Postgres stores it rounded to two decimals, so the only possible values are
 * the 101 steps 0.00 … 1.00 and there is nothing between 0.50 and 0.51 to fall
 * through. A null confidence on an enriched row is the honest floor: Low.
 */
export const getAccuracyBand = (
  status: string,
  confidence: number | null,
): AccuracyBand => {
  if (status === 'pending') return 'pending'
  // `unknown` — and any status a future migration adds without updating this
  // map — reads as None rather than silently scoring as Low.
  if (status !== 'enriched') return 'none'
  if (confidence === null || confidence <= LOW_MAX_CONFIDENCE) return 'low'
  if (confidence <= MEDIUM_MAX_CONFIDENCE) return 'medium'
  return 'high'
}

const asPercent = (value: number) => `${Math.round(value * 100)}%`

/**
 * Labels and one-line explanations for the info popover. Ranges are built from
 * the constants above so the copy cannot drift from the cuts.
 */
export const ACCURACY_BANDS: Record<
  AccuracyBand,
  { label: string; description: string }
> = {
  pending: {
    label: 'Pending',
    description: 'Not analyzed yet.',
  },
  none: {
    label: 'None',
    description:
      'The model did not recognize the recording, so it added no tags rather than guessing.',
  },
  low: {
    label: 'Low',
    description: `Barely recognized — ${asPercent(LOW_MAX_CONFIDENCE)} confidence or below.`,
  },
  medium: {
    label: 'Medium',
    description: `Recognized with reasonable confidence — ${asPercent(
      LOW_MAX_CONFIDENCE + 0.01,
    )} to ${asPercent(MEDIUM_MAX_CONFIDENCE)}.`,
  },
  high: {
    label: 'High',
    description: `Confidently recognized — ${asPercent(
      MEDIUM_MAX_CONFIDENCE + 0.01,
    )} or above.`,
  },
}
