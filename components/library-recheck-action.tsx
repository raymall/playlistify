'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  RECHECK_STATE_LABELS,
  type RecheckState,
} from '@/lib/enrichment/recheck'
import { isRecord } from '@/lib/json'

type LibraryRecheckActionProps = {
  initialState: RecheckState
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
    case 'already_checked':
      return 'checked_not_improved'
    case 'no_better_recipe':
      return 'no_better_recipe'
    default:
      return null
  }
}

export const LibraryRecheckAction = ({
  initialState,
  songId,
  songTitle,
}: LibraryRecheckActionProps) => {
  const [state, setState] = useState<RequestState>(initialState)
  const [previousInitialState, setPreviousInitialState] = useState(initialState)
  const [announcement, setAnnouncement] = useState('')

  if (previousInitialState !== initialState) {
    setPreviousInitialState(initialState)
    setState(initialState)
  }

  const handleRequest = async () => {
    setState('requesting')
    setAnnouncement(`Requesting a recheck for ${songTitle}.`)
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
        setAnnouncement(`The recheck for ${songTitle} could not be requested.`)
        return
      }
      setState(next)
      setAnnouncement(`${RECHECK_STATE_LABELS[next]} for ${songTitle}.`)
    } catch {
      setState('error')
      setAnnouncement(`The recheck for ${songTitle} could not be requested.`)
    }
  }

  const canRequest = state === 'available' || state === 'error'
  const label =
    state === 'requesting'
      ? 'Requesting…'
      : state === 'error'
        ? 'Retry recheck'
        : RECHECK_STATE_LABELS[state]

  return (
    <div className='mt-1 flex flex-col items-end gap-1'>
      {canRequest || state === 'requesting' ? (
        <Button
          aria-label={`${label} for ${songTitle}`}
          disabled={state === 'requesting'}
          size='xs'
          variant='ghost'
          onClick={() => {
            void handleRequest()
          }}
        >
          {label}
        </Button>
      ) : (
        <span className='text-xs text-muted-foreground'>{label}</span>
      )}
      <div aria-live='polite' className='sr-only' role='status'>
        {announcement}
      </div>
    </div>
  )
}
