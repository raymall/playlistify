'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  isRecheckInFlight,
  RECHECK_ERROR_LABEL,
  RECHECK_LOCKED_LABEL,
  RECHECK_STATE_LABELS,
  recheckActionLabel,
  type RecheckState,
} from '@/lib/enrichment/recheck'
import { isRecord } from '@/lib/json'

type LibraryRecheckActionProps = {
  describedById: string
  initialAttemptsRemaining: number
  initialState: RecheckState
  isPending: boolean
  songId: string
  songTitle: string
}

type RequestState = RecheckState | 'requesting' | 'error'

/**
 * The queue RPC's own vocabulary, kept unmapped: `already_queued` must stay
 * distinct from `queued` because only the latter spent one of this song's
 * tries — both still proceed to the analysis call.
 */
type RequestOutcome =
  'queued' | 'already_queued' | 'analyzing' | 'throttled' | 'no_better_recipe'

const readRequestOutcome = (value: unknown): RequestOutcome | null => {
  if (!isRecord(value)) return null
  switch (value.status) {
    case 'queued':
    case 'already_queued':
    case 'analyzing':
    case 'throttled':
    case 'no_better_recipe':
      return value.status
    default:
      return null
  }
}

export const LibraryRecheckAction = ({
  describedById,
  initialAttemptsRemaining,
  initialState,
  isPending,
  songId,
  songTitle,
}: LibraryRecheckActionProps) => {
  const router = useRouter()
  const [state, setState] = useState<RequestState>(initialState)
  const [attemptsRemaining, setAttemptsRemaining] = useState(
    initialAttemptsRemaining,
  )
  const [previousInitialState, setPreviousInitialState] = useState(initialState)
  const [previousInitialAttempts, setPreviousInitialAttempts] = useState(
    initialAttemptsRemaining,
  )
  const [announcement, setAnnouncement] = useState('')
  const statusRef = useRef<HTMLSpanElement>(null)
  const shouldRestoreFocusRef = useRef(false)

  // Two scalars rather than one object: an object prop would change identity on
  // every render and reset local state mid-request.
  if (
    previousInitialState !== initialState ||
    previousInitialAttempts !== initialAttemptsRemaining
  ) {
    setPreviousInitialState(initialState)
    setPreviousInitialAttempts(initialAttemptsRemaining)
    setState(initialState)
    setAttemptsRemaining(initialAttemptsRemaining)
  }

  const isRequesting = state === 'requesting'

  const handleRequest = async () => {
    // aria-disabled leaves the control focusable, so the guard is here rather
    // than on the button — losing focus to <body> mid-request fails WCAG 2.4.3.
    if (isRequesting || state === 'analyzing') return
    shouldRestoreFocusRef.current = true
    setState('requesting')
    setAnnouncement(`Requesting a new analysis for ${songTitle}.`)
    try {
      const response = await fetch('/api/enrichment-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId }),
      })
      const body: unknown = await response.json()
      const outcome = readRequestOutcome(body)
      if (!response.ok || outcome === null) {
        setState('error')
        setAnnouncement(`The analysis for ${songTitle} could not be requested.`)
        return
      }
      // A throttled click never reached the queue and an already-queued song
      // reserved its try earlier, so neither spends one. `no_better_recipe` is
      // the server saying nothing would run at all, which is what zero means
      // here — trust it over the count this page rendered.
      const nextRemaining =
        outcome === 'queued'
          ? Math.max(0, attemptsRemaining - 1)
          : outcome === 'no_better_recipe'
            ? 0
            : attemptsRemaining
      setAttemptsRemaining(nextRemaining)

      if (outcome === 'throttled' || outcome === 'no_better_recipe') {
        setState(outcome)
        setAnnouncement(
          outcome === 'throttled'
            ? `${songTitle} was just requested — no try was used. ${nextRemaining} left.`
            : `${songTitle} has no better analysis available yet.`,
        )
        return
      }
      if (outcome === 'analyzing') {
        setState('analyzing')
        setAnnouncement(`${songTitle} is already being analyzed.`)
        return
      }

      // Queueing only reserves the work; this second call is what analyzes it,
      // and only this song — the panel's run is what covers the whole library.
      setState('analyzing')
      setAnnouncement(`Analyzing ${songTitle}.`)
      const analysis = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId }),
      })
      const analysisBody: unknown = await analysis.json()
      if (!analysis.ok || !isRecord(analysisBody)) {
        setState('error')
        setAnnouncement(`${songTitle} could not be analyzed.`)
        return
      }
      if (analysisBody.status === 'skipped') {
        // Something else claimed it between the two calls; the row's server
        // state is now the truthful one.
        router.refresh()
        return
      }
      const isPromoted = analysisBody.isPromoted === true
      setState(isPromoted ? 'improved' : 'checked_not_improved')
      setAnnouncement(
        isPromoted
          ? `${songTitle} was improved. ${nextRemaining} ${nextRemaining === 1 ? 'try' : 'tries'} left.`
          : `${songTitle} did not improve. ${nextRemaining} ${nextRemaining === 1 ? 'try' : 'tries'} left.`,
      )
      // The badge and tags are server-rendered, so the row needs a refresh to
      // show what changed.
      router.refresh()
    } catch {
      setState('error')
      setAnnouncement(`The analysis for ${songTitle} could not be requested.`)
    }
  }

  const settledState =
    state === 'requesting' || state === 'error' ? null : state
  const isInFlight = settledState !== null && isRecheckInFlight(settledState)
  // The count, not the state name, decides whether anything can be requested:
  // "0 left" means no recipe would run, so the control has nothing to offer.
  const canRequest = !isInFlight && attemptsRemaining > 0

  const statusLabel = isInFlight
    ? RECHECK_STATE_LABELS[settledState]
    : attemptsRemaining === 0
      ? RECHECK_LOCKED_LABEL
      : // A failure has to be visible, not only announced — and without it the
        // focused status text would unmount and drop focus a second time.
        state === 'error'
        ? RECHECK_ERROR_LABEL
        : settledState === null
          ? null
          : RECHECK_STATE_LABELS[settledState]

  const actionLabel = isRequesting
    ? 'Requesting…'
    : state === 'error'
      ? 'Retry'
      : recheckActionLabel(
          attemptsRemaining,
          isPending,
          settledState === 'queued',
        )

  // A settled request removes the control the user just activated — queued, or
  // out of tries — which would drop focus to <body> (WCAG 2.4.3). Move it to
  // the status text that took the button's place, so the outcome is where the
  // focus is. Only after a real request: a prop reset must not steal focus.
  useEffect(() => {
    if (!shouldRestoreFocusRef.current || isRequesting) return
    shouldRestoreFocusRef.current = false
    if (!canRequest) statusRef.current?.focus()
  }, [canRequest, isRequesting])

  return (
    <div className='mt-1 flex flex-col items-end gap-1'>
      {statusLabel !== null && (
        <span
          ref={statusRef}
          className='rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
          tabIndex={-1}
        >
          {statusLabel}
        </span>
      )}
      {canRequest && (
        <Button
          aria-busy={isRequesting}
          aria-describedby={describedById}
          aria-disabled={isRequesting}
          aria-label={`${actionLabel} ${songTitle}`}
          size='xs'
          variant='ghost'
          onClick={() => {
            void handleRequest()
          }}
        >
          {actionLabel}
        </Button>
      )}
      <div aria-live='polite' className='sr-only' role='status'>
        {announcement}
      </div>
    </div>
  )
}
