'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { signInWithSpotify } from '@/lib/auth/spotify'
import { isRecord, readNumber, readString } from '@/lib/json'
import { wait } from '@/lib/sleep'
import { type ImportBatchResponse } from '@/lib/spotify/import'

interface LibraryImportPanelProps {
  hasLibrary: boolean
}

type ImportState =
  | { phase: 'idle' }
  | {
      phase: 'running'
      offset: number
      total: number | null
      imported: number
    }
  | {
      phase: 'waiting'
      offset: number
      secondsLeft: number
      total: number | null
      imported: number
    }
  | {
      phase: 'error'
      offset: number
      message: string
      total: number | null
      imported: number
    }
  | { phase: 'reconnect' }
  | { phase: 'done'; imported: number; total: number }

/** router.refresh() cadence so the table fills in live behind the panel. */
const REFRESH_EVERY_N_BATCHES = 5

/** Parse the route's JSON body into the response contract, or null if malformed. */
const parseResponse = (value: unknown): ImportBatchResponse | null => {
  if (!isRecord(value)) return null
  const { status } = value
  if (status === 'progress') {
    const nextOffset = readNumber(value.nextOffset)
    const total = readNumber(value.total)
    const importedCount = readNumber(value.importedCount)
    if (nextOffset === null || total === null || importedCount === null) {
      return null
    }
    return { status, nextOffset, total, importedCount }
  }
  if (status === 'done') {
    const total = readNumber(value.total)
    const importedCount = readNumber(value.importedCount)
    if (total === null || importedCount === null) return null
    return { status, total, importedCount }
  }
  if (status === 'rate_limited') {
    const retryAfterSeconds = readNumber(value.retryAfterSeconds)
    if (retryAfterSeconds === null) return null
    return { status, retryAfterSeconds }
  }
  if (status === 'reconnect_required') return { status }
  if (status === 'error') {
    return {
      status,
      message: readString(value.message) ?? 'Something went wrong.',
    }
  }
  return null
}

/**
 * Drives the client-side import loop: repeatedly POSTs one batch to
 * /api/import, folding each response into a small state machine. The loop is a
 * plain async function started by the button (never an effect), so React strict
 * mode can't double-fire it; unmount safety comes from aborting the run's
 * controller on unmount and checking its signal after every await.
 */
export const LibraryImportPanel = ({ hasLibrary }: LibraryImportPanelProps) => {
  const router = useRouter()
  const [state, setState] = useState<ImportState>({ phase: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const runImport = async (
    startOffset: number,
    startImported: number,
    startTotal: number | null,
  ) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    // Unmount/abort can flip signal.aborted mid-await, but TypeScript's flow
    // analysis would narrow it to false after the first guard and treat every
    // later check as redundant. Funnelling through a call keeps each check live.
    const isStopped = () => signal.aborted

    let offset = startOffset
    let imported = startImported
    let total = startTotal
    let batchesSinceRefresh = 0
    let lastDecile = -1
    let hasAnnouncedWaiting = false

    setAnnouncement('Import started.')

    while (!isStopped()) {
      setState({
        phase: 'running',
        offset,
        total,
        imported,
      })

      let response: Response
      try {
        response = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset }),
          signal,
        })
      } catch {
        if (isStopped()) return
        setState({
          phase: 'error',
          offset,
          message: 'Network error — check your connection and retry.',
          total,
          imported,
        })
        setAnnouncement('Import paused by a network error.')
        return
      }
      if (isStopped()) return

      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (isStopped()) return

      const parsed = parseResponse(payload)
      if (parsed === null) {
        setState({
          phase: 'error',
          offset,
          message: 'The server returned an unexpected response.',
          total,
          imported,
        })
        setAnnouncement('Import paused by an error.')
        return
      }

      if (parsed.status === 'reconnect_required') {
        setState({ phase: 'reconnect' })
        setAnnouncement('Spotify needs to be reconnected.')
        return
      }
      if (parsed.status === 'error') {
        setState({
          phase: 'error',
          offset,
          message: parsed.message,
          total,
          imported,
        })
        setAnnouncement('Import paused by an error.')
        return
      }
      if (parsed.status === 'rate_limited') {
        if (!hasAnnouncedWaiting) {
          hasAnnouncedWaiting = true
          setAnnouncement(
            'Spotify rate limit reached; the import will resume automatically.',
          )
        }
        let secondsLeft = parsed.retryAfterSeconds
        while (secondsLeft > 0 && !isStopped()) {
          setState({
            phase: 'waiting',
            offset,
            secondsLeft,
            total,
            imported,
          })
          await wait(1000, signal)
          secondsLeft -= 1
        }
        continue
      }

      imported += parsed.importedCount
      total = parsed.total

      if (parsed.status === 'done') {
        setState({ phase: 'done', imported, total })
        setAnnouncement(
          total === 0
            ? 'No Liked Songs found.'
            : `Import complete. ${imported.toLocaleString()} songs imported.`,
        )
        router.refresh()
        return
      }

      offset = parsed.nextOffset
      if (total > 0) {
        const decile = Math.min(
          Math.floor((Math.min(offset, total) / total) * 10),
          9,
        )
        if (decile > lastDecile) {
          lastDecile = decile
          if (decile > 0) setAnnouncement(`${decile * 10}% imported.`)
        }
      }
      batchesSinceRefresh += 1
      if (batchesSinceRefresh >= REFRESH_EVERY_N_BATCHES) {
        batchesSinceRefresh = 0
        router.refresh()
      }
    }
  }

  const handleStart = () => {
    if (state.phase === 'error') {
      void runImport(state.offset, state.imported, state.total)
    } else {
      void runImport(0, 0, null)
    }
  }

  const isPrimaryDisabled =
    state.phase === 'running' || state.phase === 'waiting'
  const primaryLabel =
    state.phase === 'error'
      ? 'Retry'
      : hasLibrary
        ? 'Re-sync Liked Songs'
        : 'Import Liked Songs'

  const isProgressVisible =
    state.phase === 'running' ||
    state.phase === 'waiting' ||
    state.phase === 'error'

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        {state.phase === 'reconnect' ? (
          <Button onClick={() => void signInWithSpotify()}>
            Reconnect Spotify
          </Button>
        ) : (
          <Button disabled={isPrimaryDisabled} onClick={handleStart}>
            {primaryLabel}
          </Button>
        )}
        {state.phase === 'waiting' && (
          <span className='text-sm text-muted-foreground tabular-nums'>
            Rate limited — resuming in {state.secondsLeft}s
          </span>
        )}
      </div>

      {isProgressVisible && (
        <div className='flex flex-col gap-2'>
          <Progress
            aria-label='Liked Songs import progress'
            className='w-full max-w-md motion-reduce:**:data-[slot=progress-indicator]:transition-none'
            max={state.total ?? 100}
            value={
              state.total === null ? null : Math.min(state.offset, state.total)
            }
          />
          <p className='text-sm text-muted-foreground tabular-nums'>
            {state.total === null
              ? 'Preparing…'
              : `${Math.min(state.offset, state.total).toLocaleString()} / ${state.total.toLocaleString()} songs`}
          </p>
        </div>
      )}

      {state.phase === 'error' && (
        <p className='text-sm text-destructive'>{state.message}</p>
      )}

      {state.phase === 'reconnect' && (
        <p className='text-sm text-muted-foreground'>
          Your Spotify connection expired. Reconnect to import your Liked Songs.
        </p>
      )}

      {state.phase === 'done' && (
        <p className='text-sm text-muted-foreground'>
          {state.total === 0
            ? 'No Liked Songs found in your Spotify library.'
            : `Imported ${state.imported.toLocaleString()} songs from your Spotify library.`}
        </p>
      )}

      <div className='sr-only' role='status'>
        {announcement}
      </div>
    </div>
  )
}
