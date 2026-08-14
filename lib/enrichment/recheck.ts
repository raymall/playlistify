/** Mirrors the budget in `enrichment_attempts_remaining_at_rank()`. */
export const RECHECK_ATTEMPTS_PER_LEVEL = 3

export type RecheckState =
  | 'available'
  | 'queued'
  | 'analyzing'
  | 'throttled'
  | 'no_better_recipe'
  | 'checked_not_improved'
  | 'improved'

export const readRecheckState = (value: string): RecheckState | null => {
  switch (value) {
    case 'available':
    case 'queued':
    case 'analyzing':
    case 'throttled':
    case 'no_better_recipe':
    case 'checked_not_improved':
    case 'improved':
      return value
    default:
      return null
  }
}

/**
 * What the last analysis concluded. `available` has nothing to report yet, and
 * a locked song is described by `RECHECK_LOCKED_LABEL` instead — a song can be
 * both "no change" and out of tries, and out of tries is the more useful of the
 * two to lead with.
 */
export const RECHECK_STATE_LABELS: Record<RecheckState, string | null> = {
  available: null,
  queued: 'Queued',
  analyzing: 'Analyzing…',
  throttled: 'Just requested',
  no_better_recipe: 'No better result yet',
  checked_not_improved: 'No change',
  improved: 'Improved',
}

/** Shown in place of the outcome once a song has no analysis left to run. */
export const RECHECK_LOCKED_LABEL = 'No better result yet'

/** A request or analysis that failed; the control stays available to retry. */
export const RECHECK_ERROR_LABEL = 'Could not analyze'

/**
 * Only a held lease blocks a request. A merely queued song has reserved its
 * work without starting it, so it stays actionable — otherwise a row queued by
 * an interrupted run would have no way to finish from the row itself.
 */
export const isRecheckInFlight = (state: RecheckState) => state === 'analyzing'

/**
 * The action label. A song that has never been analyzed is *analyzed*, not
 * re-analyzed; a queued one has already spent its try and only needs running;
 * and the remaining count only earns its space once it has moved.
 */
export const recheckActionLabel = (
  attemptsRemaining: number,
  isPending: boolean,
  isQueued: boolean,
) => {
  if (isQueued) return 'Analyze now'
  const verb = isPending ? 'Analyze' : 'Re-analyze'
  return attemptsRemaining >= RECHECK_ATTEMPTS_PER_LEVEL
    ? verb
    : `${verb} (${attemptsRemaining} left)`
}

/**
 * The two things the control cannot explain on its own: that the result is
 * shared, and that tries are finite. Kept here so the popover, the row's
 * screen-reader description, and any future surface cannot drift apart.
 */
export const RECHECK_SHARED_RESULT_COPY =
  'We only replace shared analysis when the new result is better. Improvements apply everywhere this song appears.'

export const RECHECK_BUDGET_COPY = `Each song gets up to ${RECHECK_ATTEMPTS_PER_LEVEL} tries at the current quality level. After that it waits until a better analysis is available.`
