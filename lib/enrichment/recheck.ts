export type RecheckState =
  | 'available'
  | 'queued'
  | 'analyzing'
  | 'no_better_recipe'
  | 'checked_not_improved'
  | 'improved'

export const readRecheckState = (value: string): RecheckState | null => {
  switch (value) {
    case 'available':
    case 'queued':
    case 'analyzing':
    case 'no_better_recipe':
    case 'checked_not_improved':
    case 'improved':
      return value
    default:
      return null
  }
}

export const RECHECK_STATE_LABELS: Record<RecheckState, string> = {
  available: 'Request recheck',
  queued: 'Queued',
  analyzing: 'Analyzing',
  no_better_recipe: 'No higher confidence yet',
  checked_not_improved: 'Checked, not improved',
  improved: 'Improved',
}
