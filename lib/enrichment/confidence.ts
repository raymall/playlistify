// Model-reported recognition confidence bands shown in the Library. Confidence
// is not measured accuracy, so the help copy keeps that distinction explicit.

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
