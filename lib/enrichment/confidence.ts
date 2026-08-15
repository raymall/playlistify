// Model-reported recognition confidence bands shown in the Library. Confidence
// is not measured accuracy, so the help copy keeps that distinction explicit.

/** Mirrors the budget in `enrichment_attempts_remaining_at_rank()`. */
export const ANALYSES_PER_RECIPE_RANK = 3

/**
 * The two things the Confidence panel cannot explain on its own: that the
 * result is shared, and that tries are finite. Kept beside the band rule so
 * every surface describing analysis quality reads from one place.
 */
export const ANALYSIS_SHARED_RESULT_COPY =
  'We only replace shared analysis when the new result is better. Improvements apply everywhere this song appears.'

export const ANALYSIS_BUDGET_COPY = `Each song gets up to ${ANALYSES_PER_RECIPE_RANK} tries at the current quality level. After that it waits until a stronger recipe is enabled.`

/** Top of the Low band, inclusive. */
export const LOW_MAX_CONFIDENCE = 0.5

/** Top of the Medium band, inclusive. */
export const MEDIUM_MAX_CONFIDENCE = 0.75

export type ConfidenceBand = 'pending' | 'none' | 'low' | 'medium' | 'high'

export const CONFIDENCE_BAND_ORDER = [
  'pending',
  'none',
  'low',
  'medium',
  'high',
] as const

/** Narrows a URL param or API value onto the band union. */
export const readConfidenceBand = (value: unknown): ConfidenceBand | null => {
  switch (value) {
    case 'pending':
    case 'none':
    case 'low':
    case 'medium':
    case 'high':
      return value
    default:
      return null
  }
}

/**
 * The app-side band rule. Mirrored in SQL by `public.confidence_band()`, which
 * the Library filter and the panel counts both go through — change one and the
 * badge, the filter, and the totals disagree.
 */
export const getConfidenceBand = (
  status: string,
  confidence: number | null,
): ConfidenceBand => {
  if (status === 'pending') return 'pending'
  if (status !== 'enriched') return 'none'
  if (confidence === null || confidence <= LOW_MAX_CONFIDENCE) {
    return 'low'
  }
  if (confidence <= MEDIUM_MAX_CONFIDENCE) return 'medium'
  return 'high'
}

export const CONFIDENCE_BANDS: Record<
  ConfidenceBand,
  { label: string; description: string }
> = {
  pending: {
    label: 'Pending',
    description: 'No shared confidence result has completed yet.',
  },
  none: {
    label: 'None',
    description:
      'The model did not recognize the recording well enough to produce trustworthy shared tags.',
  },
  low: {
    label: 'Low',
    description:
      'The recording was recognized with low confidence. Its AI tags stay visible but do not drive playlist matching.',
  },
  medium: {
    label: 'Medium',
    description:
      'The recording was recognized with medium confidence and can guide playlist matching.',
  },
  high: {
    label: 'High',
    description:
      'The recording was recognized with high confidence and can guide playlist matching.',
  },
}
