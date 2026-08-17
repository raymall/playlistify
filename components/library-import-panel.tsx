'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { signInWithSpotify } from '@/lib/auth/spotify'
import { isRecord, readJson, readNumber, readString } from '@/lib/json'
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
      syncStartedAt: string | null
    }
  | {
      phase: 'waiting'
      offset: number
      secondsLeft: number
      reason: 'rate_limit' | 'transient'
      total: number | null
      imported: number
      syncStartedAt: string | null
    }
  | {
      phase: 'error'
      offset: number
      message: string
      total: number | null
      imported: number
      syncStartedAt: string | null
    }
  | { phase: 'reconnect' }
  | { phase: 'done'; imported: number; removed: number; total: number }

/** router.refresh() cadence so the table fills in live behind the panel. */
const REFRESH_EVERY_N_BATCHES = 5

/**
 * Failures the server marks `safeToRetry` can be repeated at the same offset
 * because every import write is idempotent. This covers auth blips and
 * exhausted transport retries even when the server lost the response after a
 * write landed. Ten attempts at the delays below rides out roughly two minutes.
 */
const MAX_SAFE_RETRIES = 10

/** 1s → 2s → 4s → 8s → 15s (capped) between consecutive failed attempts. */
const transientDelaySeconds = (failures: number) =>
  Math.min(15, 2 ** (failures - 1))

/** Parse the route's JSON body into the response contract, or null if malformed. */
const parseResponse = (value: unknown): ImportBatchResponse | null => {
  if (!isRecord(value)) return null
  const { status } = value
  if (status === 'progress') {
    const nextOffset = readNumber(value.nextOffset)
    const total = readNumber(value.total)
    const importedCount = readNumber(value.importedCount)
    const syncStartedAt = readString(value.syncStartedAt)
    if (
      nextOffset === null ||
      total === null ||
      importedCount === null ||
      syncStartedAt === null
    ) {
      return null
    }
    return { status, nextOffset, total, importedCount, syncStartedAt }
  }
  if (status === 'done') {
    const total = readNumber(value.total)
    const importedCount = readNumber(value.importedCount)
    const removedCount = readNumber(value.removedCount)
    if (total === null || importedCount === null || removedCount === null) {
      return null
    }
    return { status, total, importedCount, removedCount }
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
      safeToRetry: value.safeToRetry === true,
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
    startSyncStartedAt: string | null,
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
    let syncStartedAt = startSyncStartedAt
    let batchesSinceRefresh = 0
    let lastDecile = -1
    let hasAnnouncedWaiting = false
    let safeRetries = 0
    let hasAnnouncedRetrying = false

    setAnnouncement('Import started.')

    while (!isStopped()) {
      setState({
        phase: 'running',
        offset,
        total,
        imported,
        syncStartedAt,
      })

      let response: Response
      try {
        response = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset, syncStartedAt }),
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
          syncStartedAt,
        })
        setAnnouncement('Import paused by a network error.')
        return
      }
      if (isStopped()) return

      const payload = await readJson(response)
      if (isStopped()) return

      const parsed = parseResponse(payload)
      if (parsed === null) {
        setState({
          phase: 'error',
          offset,
          message: 'The server returned an unexpected response.',
          total,
          imported,
          syncStartedAt,
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
        // Idempotent transport failures ride it out rather than dropping the
        // user into a manual Retry — a connection blip is not an import problem.
        if (parsed.safeToRetry === true && safeRetries < MAX_SAFE_RETRIES) {
          safeRetries += 1
          if (!hasAnnouncedRetrying) {
            hasAnnouncedRetrying = true
            setAnnouncement(
              'Connection problem; the import will resume automatically.',
            )
          }
          let secondsLeft = transientDelaySeconds(safeRetries)
          while (secondsLeft > 0 && !isStopped()) {
            setState({
              phase: 'waiting',
              offset,
              secondsLeft,
              reason: 'transient',
              total,
              imported,
              syncStartedAt,
            })
            await wait(1000, signal)
            secondsLeft -= 1
          }
          continue
        }
        setState({
          phase: 'error',
          offset,
          message: parsed.message,
          total,
          imported,
          syncStartedAt,
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
            reason: 'rate_limit',
            total,
            imported,
            syncStartedAt,
          })
          await wait(1000, signal)
          secondsLeft -= 1
        }
        continue
      }

      // A batch that lands clears the transient budget: the next outage gets a
      // full allowance rather than inheriting an exhausted one.
      safeRetries = 0
      imported += parsed.importedCount
      total = parsed.total

      if (parsed.status === 'done') {
        setState({
          phase: 'done',
          imported,
          removed: parsed.removedCount,
          total,
        })
        const removedSummary =
          parsed.removedCount === 0
            ? ''
            : ` Removed ${parsed.removedCount.toLocaleString()} no longer liked ${
                parsed.removedCount === 1 ? 'song' : 'songs'
              }.`
        setAnnouncement(
          total === 0
            ? `No Liked Songs found.${removedSummary}`
            : `Import complete. ${imported.toLocaleString()} songs imported.${removedSummary}`,
        )
        router.refresh()
        return
      }

      offset = parsed.nextOffset
      syncStartedAt = parsed.syncStartedAt
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
      void runImport(
        state.offset,
        state.imported,
        state.total,
        state.syncStartedAt,
      )
    } else {
      void runImport(0, 0, null, null)
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
            {state.reason === 'rate_limit'
              ? `Rate limited — resuming in ${state.secondsLeft}s`
              : `Connection problem — retrying in ${state.secondsLeft}s`}
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
          {state.removed > 0 &&
            ` Removed ${state.removed.toLocaleString()} no longer liked ${
              state.removed === 1 ? 'song' : 'songs'
            }.`}
        </p>
      )}

      <div className='sr-only' role='status'>
        {announcement}
      </div>
    </div>
  )
}
