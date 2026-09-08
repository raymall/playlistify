'use client'

import { CircleAlertIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { signInWithSpotify } from '@/lib/auth/spotify'
import { readJson } from '@/lib/json'
import { wait } from '@/lib/sleep'
import {
  parseSyncBatchResponse,
  SYNC_PHASES,
  SYNC_START_CURSOR,
  type SyncCursor,
  type SyncPhase,
} from '@/lib/spotify/sync-contract'

type LibraryImportPanelProps = {
  hasLibrary: boolean
}

/** Everything the loop needs to continue, and the bar needs to draw. */
type SyncProgress = {
  cursor: SyncCursor
  syncStartedAt: string | null
  syncPhase: SyncPhase
  phaseCurrent: number
  phaseTotal: number | null
  imported: number
}

type ImportState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: SyncProgress }
  | {
      phase: 'waiting'
      progress: SyncProgress
      secondsLeft: number
      reason: 'rate_limit' | 'transient'
    }
  | { phase: 'error'; progress: SyncProgress; message: string }
  | { phase: 'reconnect' }
  | { phase: 'done'; total: number; removed: number }

const START_PROGRESS: SyncProgress = {
  cursor: SYNC_START_CURSOR,
  syncStartedAt: null,
  syncPhase: 'liked',
  phaseCurrent: 0,
  phaseTotal: null,
  imported: 0,
}

const PHASE_ANNOUNCEMENTS: Record<SyncPhase, string> = {
  liked: 'Syncing Liked Songs.',
  playlists: 'Liked Songs synced. Syncing your playlists.',
  albums: 'Playlists synced. Syncing saved albums.',
}

/** router.refresh() cadence so the table fills in live behind the panel. */
const REFRESH_EVERY_N_BATCHES = 5

/**
 * Failures the server marks `safeToRetry` can be repeated at the same cursor
 * because every sync write is idempotent. This covers auth blips and
 * exhausted transport retries even when the server lost the response after a
 * write landed. Ten attempts at the delays below rides out roughly two minutes.
 */
const MAX_SAFE_RETRIES = 10

/** 1s → 2s → 4s → 8s → 15s (capped) between consecutive failed attempts. */
const transientDelaySeconds = (failures: number) =>
  Math.min(15, 2 ** (failures - 1))

/**
 * One bar, three equal segments — one per phase. A phase's total can appear
 * late (playlists are listed on the phase's first batch), so the bar only ever
 * moves forward: a phase with no total yet sits at its segment's start.
 */
const progressPercent = ({
  syncPhase,
  phaseCurrent,
  phaseTotal,
}: SyncProgress) => {
  const ratio =
    phaseTotal === null || phaseTotal === 0
      ? 0
      : Math.min(phaseCurrent / phaseTotal, 1)
  return Math.round(
    ((SYNC_PHASES.indexOf(syncPhase) + ratio) / SYNC_PHASES.length) * 100,
  )
}

const phaseLabel = ({ syncPhase, phaseCurrent, phaseTotal }: SyncProgress) => {
  switch (syncPhase) {
    case 'liked':
      return phaseTotal === null
        ? 'Preparing…'
        : `Liked Songs — ${Math.min(phaseCurrent, phaseTotal).toLocaleString()} / ${phaseTotal.toLocaleString()}`
    case 'playlists':
      return phaseTotal === null
        ? 'Listing playlists…'
        : phaseTotal === 0
          ? 'No playlists'
          : `Playlist ${Math.min(phaseCurrent + 1, phaseTotal).toLocaleString()} of ${phaseTotal.toLocaleString()}`
    case 'albums':
      return phaseTotal === null
        ? 'Preparing albums…'
        : `Albums — ${Math.min(phaseCurrent, phaseTotal).toLocaleString()} / ${phaseTotal.toLocaleString()}`
  }
}

/**
 * Drives the client-side sync loop: repeatedly POSTs the echoed cursor to
 * /api/import, folding each response into a small state machine. The loop is
 * a plain async function started by the button (never an effect), so React
 * strict mode can't double-fire it; unmount safety comes from aborting the
 * run's controller on unmount and checking its signal after every await.
 */
export const LibraryImportPanel = ({ hasLibrary }: LibraryImportPanelProps) => {
  const router = useRouter()
  const [state, setState] = useState<ImportState>({ phase: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const runSync = async (start: SyncProgress) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    // Unmount/abort can flip signal.aborted mid-await, but TypeScript's flow
    // analysis would narrow it to false after the first guard and treat every
    // later check as redundant. Funnelling through a call keeps each check live.
    const isStopped = () => signal.aborted

    let progress = start
    let batchesSinceRefresh = 0
    let hasAnnouncedWaiting = false
    let safeRetries = 0
    let hasAnnouncedRetrying = false

    setAnnouncement('Sync started.')

    while (!isStopped()) {
      setState({ phase: 'running', progress })

      let response: Response
      try {
        response = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cursor: progress.cursor,
            syncStartedAt: progress.syncStartedAt,
          }),
          signal,
        })
      } catch {
        if (isStopped()) return
        setState({
          phase: 'error',
          progress,
          message: 'Network error — check your connection and retry.',
        })
        setAnnouncement('Sync paused by a network error.')
        return
      }
      if (isStopped()) return

      const payload = await readJson(response)
      if (isStopped()) return

      const parsed = parseSyncBatchResponse(payload)
      if (parsed === null) {
        setState({
          phase: 'error',
          progress,
          message: 'The server returned an unexpected response.',
        })
        setAnnouncement('Sync paused by an error.')
        return
      }

      if (parsed.status === 'reconnect_required') {
        setState({ phase: 'reconnect' })
        setAnnouncement('Spotify needs to be reconnected.')
        return
      }
      if (parsed.status === 'error') {
        // Idempotent transport failures ride it out rather than dropping the
        // user into a manual Retry — a connection blip is not a sync problem.
        if (parsed.safeToRetry === true && safeRetries < MAX_SAFE_RETRIES) {
          safeRetries += 1
          if (!hasAnnouncedRetrying) {
            hasAnnouncedRetrying = true
            setAnnouncement(
              'Connection problem; the sync will resume automatically.',
            )
          }
          let secondsLeft = transientDelaySeconds(safeRetries)
          while (secondsLeft > 0 && !isStopped()) {
            setState({
              phase: 'waiting',
              progress,
              secondsLeft,
              reason: 'transient',
            })
            await wait(1000, signal)
            secondsLeft -= 1
          }
          continue
        }
        setState({ phase: 'error', progress, message: parsed.message })
        setAnnouncement('Sync paused by an error.')
        return
      }
      if (parsed.status === 'rate_limited') {
        if (!hasAnnouncedWaiting) {
          hasAnnouncedWaiting = true
          setAnnouncement(
            'Spotify rate limit reached; the sync will resume automatically.',
          )
        }
        let secondsLeft = parsed.retryAfterSeconds
        while (secondsLeft > 0 && !isStopped()) {
          setState({
            phase: 'waiting',
            progress,
            secondsLeft,
            reason: 'rate_limit',
          })
          await wait(1000, signal)
          secondsLeft -= 1
        }
        continue
      }

      // A batch that lands clears the transient budget: the next outage gets a
      // full allowance rather than inheriting an exhausted one.
      safeRetries = 0

      if (parsed.status === 'done') {
        setState({
          phase: 'done',
          total: parsed.total,
          removed: parsed.removedCount,
        })
        const removedSummary =
          parsed.removedCount === 0
            ? ''
            : ` Removed ${parsed.removedCount.toLocaleString()} ${
                parsed.removedCount === 1 ? 'song' : 'songs'
              } no longer in your Spotify library.`
        setAnnouncement(
          parsed.total === 0
            ? `No songs found in your Spotify library.${removedSummary}`
            : `Sync complete. ${parsed.total.toLocaleString()} songs in your library.${removedSummary}`,
        )
        router.refresh()
        return
      }

      const previousPhase = progress.syncPhase
      progress = {
        cursor: parsed.next,
        syncStartedAt: parsed.syncStartedAt,
        syncPhase: parsed.phase,
        phaseCurrent: parsed.phaseCurrent,
        phaseTotal: parsed.phaseTotal,
        imported: progress.imported + parsed.batchImported,
      }
      if (parsed.phase !== previousPhase) {
        setAnnouncement(PHASE_ANNOUNCEMENTS[parsed.phase])
      }
      batchesSinceRefresh += 1
      if (batchesSinceRefresh >= REFRESH_EVERY_N_BATCHES) {
        batchesSinceRefresh = 0
        router.refresh()
      }
    }
  }

  const handleStart = () => {
    void runSync(state.phase === 'error' ? state.progress : START_PROGRESS)
  }

  const isPrimaryDisabled =
    state.phase === 'running' || state.phase === 'waiting'
  const primaryLabel =
    state.phase === 'error'
      ? 'Retry'
      : hasLibrary
        ? 'Sync Library'
        : 'Import Library'

  const isProgressVisible =
    state.phase === 'running' || state.phase === 'waiting'

  const progressLabel =
    state.phase === 'running' || state.phase === 'waiting'
      ? state.phase === 'waiting'
        ? state.reason === 'rate_limit'
          ? `Rate limited — resuming in ${state.secondsLeft}s`
          : `Connection problem — retrying in ${state.secondsLeft}s`
        : phaseLabel(state.progress)
      : ''

  return (
    <div className='flex w-full flex-col gap-2 sm:grid sm:w-72 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3 lg:w-[30rem]'>
      <div className='order-2 flex min-w-0 items-center sm:order-none sm:h-10'>
        {isProgressVisible ? (
          <div className='flex w-full min-w-0 flex-col gap-1'>
            <Progress
              aria-label='Library sync progress'
              className='w-full motion-reduce:**:data-[slot=progress-indicator]:transition-none'
              max={100}
              value={progressPercent(state.progress)}
            />
            <p className='truncate font-mono text-[0.6875rem] text-muted-foreground tabular-nums'>
              {progressLabel}
            </p>
          </div>
        ) : state.phase === 'error' ? (
          <div
            className='flex min-w-0 items-start gap-1.5 text-xs leading-tight text-destructive'
            title={state.message}
          >
            <CircleAlertIcon
              aria-hidden='true'
              className='mt-0.5 size-3.5 shrink-0'
            />
            <p className='line-clamp-2'>{state.message}</p>
          </div>
        ) : state.phase === 'reconnect' ? (
          <p className='line-clamp-2 text-xs leading-tight text-muted-foreground'>
            Spotify connection expired. Reconnect to sync.
          </p>
        ) : state.phase === 'done' ? (
          <p className='line-clamp-2 text-xs leading-tight text-muted-foreground'>
            {state.total === 0
              ? 'No songs found in your Spotify library.'
              : `${state.total.toLocaleString()} songs synced.`}
            {state.removed > 0 && ` ${state.removed.toLocaleString()} removed.`}
          </p>
        ) : (
          <span aria-hidden='true' />
        )}
      </div>

      {state.phase === 'reconnect' ? (
        <Button
          className='order-1 w-full sm:order-none sm:w-auto'
          onClick={() => void signInWithSpotify()}
        >
          Reconnect Spotify
        </Button>
      ) : (
        <Button
          className='order-1 w-full sm:order-none sm:w-auto'
          disabled={isPrimaryDisabled}
          variant={hasLibrary ? 'outline' : 'default'}
          onClick={handleStart}
        >
          {primaryLabel}
        </Button>
      )}

      <div className='sr-only sm:col-span-2' role='status'>
        {announcement}
      </div>
    </div>
  )
}
