'use client'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  isRecheckInFlight,
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

const readRequestState = (value: unknown): RecheckState | null => {
  if (!isRecord(value)) return null
  switch (value.status) {
    case 'queued':
    case 'already_queued':
      return 'queued'
    case 'analyzing':
      return 'analyzing'
    case 'throttled':
      return 'throttled'
    case 'no_better_recipe':
      return 'no_better_recipe'
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
    if (isRequesting) return
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
      const next = readRequestState(body)
      if (!response.ok || next === null) {
        setState('error')
        setAnnouncement(`The analysis for ${songTitle} could not be requested.`)
        return
      }
      setState(next)
      // A throttled click never reached the queue, so it never spent a try.
      // `no_better_recipe` is the server saying nothing would run at all, which
      // is what zero means here — trust it over the count this page rendered.
      const nextRemaining =
        next === 'queued'
          ? Math.max(0, attemptsRemaining - 1)
          : next === 'no_better_recipe'
            ? 0
            : attemptsRemaining
      setAttemptsRemaining(nextRemaining)
      setAnnouncement(
        next === 'throttled'
          ? `${songTitle} was just requested — no try was used. ${nextRemaining} left.`
          : next === 'no_better_recipe'
            ? `${songTitle} has no better analysis available yet.`
            : `${RECHECK_STATE_LABELS[next] ?? 'Requested'} for ${songTitle}. ${nextRemaining} ${nextRemaining === 1 ? 'try' : 'tries'} left.`,
      )
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
      : state === 'error'
        ? null
        : settledState === null
          ? null
          : RECHECK_STATE_LABELS[settledState]

  const actionLabel = isRequesting
    ? 'Requesting…'
    : state === 'error'
      ? 'Retry'
      : recheckActionLabel(attemptsRemaining, isPending)

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
