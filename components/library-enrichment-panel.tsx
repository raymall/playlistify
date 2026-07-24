'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type EnrichBatchResponse,
  type EnrichmentCounts,
} from '@/lib/enrichment/engine'
import { isRecord, readNumber, readString } from '@/lib/json'
import { wait } from '@/lib/sleep'
import { createClient } from '@/lib/supabase/client'

/** Catalog row shape the server page passes down — plain data only. */
export interface EnrichmentModelOption {
  id: string
  label: string
}

interface LibraryEnrichmentPanelProps {
  defaultModelId: string | null
  models: EnrichmentModelOption[]
  pendingCount: number
  totalCount: number
}

type EnrichmentState =
  | { phase: 'idle' }
  | {
      phase: 'running'
      processedThisRun: number
      counts: EnrichmentCounts | null
      /** Non-null while riding out safe-to-retry server failures; holds the
       * server's error detail ('' when it sent none). */
      retryDetail: string | null
    }
  | { phase: 'capReached'; counts: EnrichmentCounts }
  | {
      phase: 'error'
      processedThisRun: number
      message: string
      counts: EnrichmentCounts | null
    }
  | { phase: 'done'; counts: EnrichmentCounts }

/**
 * Consecutive zero-progress batches before the loop stops. Songs the model
 * omits stay pending and are re-selected first, so without this brake a
 * refused song would loop (and bill) forever.
 */
const MAX_STALLED_BATCHES = 3

/**
 * Consecutive ambiguous failures (client network drop, 401, gateway errors
 * with no readable body) absorbed before the loop pauses. Batches are
 * resumable by design, so a retried batch only re-processes songs that never
 * committed.
 */
const MAX_TRANSIENT_FAILURES = 8

/**
 * Errors the server explicitly marks `safeToRetry: false` happened after the
 * billable model call — every automatic retry re-bills a full batch. One
 * retry absorbs a mid-batch blip; a second failure pauses before the loop
 * burns money on a deterministic error.
 */
const MAX_BILLED_FAILURES = 2

/**
 * Errors marked `safeToRetry: true` cost nothing to redo, so they ride out
 * long outages (a sleep-wake or dropped uplink can run the better part of an
 * hour). At the 15s delay cap plus request time this is roughly an hour of
 * riding before the loop gives up and asks for a manual retry.
 */
const MAX_SAFE_RETRIES = 120

/** 1s → 2s → 4s → 8s → 15s (capped) between consecutive failed attempts. */
const transientDelayMs = (failures: number) =>
  Math.min(15000, 1000 * 2 ** (failures - 1))

const isTransientStatus = (status: number) =>
  status === 401 || status === 408 || status === 429 || status >= 500

const readCounts = (
  value: Record<string, unknown>,
): EnrichmentCounts | null => {
  const total = readNumber(value.total)
  const enriched = readNumber(value.enriched)
  const unknown = readNumber(value.unknown)
  const pending = readNumber(value.pending)
  if (total === null || enriched === null) return null
  if (unknown === null || pending === null) return null
  return { total, enriched, unknown, pending }
}

/** Parse the route's JSON body into the response contract, or null if malformed. */
const parseResponse = (value: unknown): EnrichBatchResponse | null => {
  if (!isRecord(value)) return null
  const { status } = value
  if (status === 'progress') {
    const batchProcessed = readNumber(value.batchProcessed)
    const batchEnriched = readNumber(value.batchEnriched)
    const batchUnknown = readNumber(value.batchUnknown)
    const counts = readCounts(value)
    if (batchProcessed === null || batchEnriched === null) return null
    if (batchUnknown === null || counts === null) return null
    return { status, batchProcessed, batchEnriched, batchUnknown, ...counts }
  }
  if (status === 'done' || status === 'cap_reached') {
    const counts = readCounts(value)
    if (counts === null) return null
    return { status, ...counts }
  }
  if (status === 'error') {
    return {
      status,
      message: readString(value.message) ?? 'Something went wrong.',
      safeToRetry: value.safeToRetry === true,
    }
  }
  return null
}

const toCounts = (value: EnrichmentCounts): EnrichmentCounts => ({
  total: value.total,
  enriched: value.enriched,
  unknown: value.unknown,
  pending: value.pending,
})

/**
 * Drives the client-side enrichment loop: repeatedly POSTs one batch to
 * /api/enrich with the chosen catalog model id, folding each response into a
 * state machine. Mirrors LibraryImportPanel: the loop is a plain async
 * function started by the button (never an effect); unmount safety comes from
 * aborting the run's controller on unmount and checking its signal after
 * every await. Enrichment never starts on its own.
 */
export const LibraryEnrichmentPanel = ({
  defaultModelId,
  models,
  pendingCount,
  totalCount,
}: LibraryEnrichmentPanelProps) => {
  const router = useRouter()
  const modelLabelId = useId()
  const modelTriggerId = useId()
  const [state, setState] = useState<EnrichmentState>({ phase: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const [modelId, setModelId] = useState<string | null>(
    defaultModelId ?? models.at(0)?.id ?? null,
  )
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const runEnrichment = async (startProcessed: number) => {
    if (modelId === null) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    // Unmount/abort can flip signal.aborted mid-await; funnelling through a
    // call keeps each check live against TypeScript's flow narrowing.
    const isStopped = () => signal.aborted

    let processedThisRun = startProcessed
    let counts: EnrichmentCounts | null = null
    let lastDecile = -1
    let stalledBatches = 0
    let transientFailures = 0
    let billedFailures = 0
    let safeRetries = 0
    // Sticky across the retried request so the banner doesn't flap off while
    // the next attempt is in flight; cleared only by a parsed success.
    let retryDetail: string | null = null

    // Reads the live processedThisRun/counts bindings at call time.
    const pauseWithError = (message: string, note: string) => {
      setState({ phase: 'error', processedThisRun, message, counts })
      setAnnouncement(note)
    }

    setAnnouncement('Enrichment started.')

    while (!isStopped()) {
      setState({ phase: 'running', processedThisRun, counts, retryDetail })

      let response: Response | null
      try {
        response = await fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, processedSoFar: processedThisRun }),
          signal,
        })
      } catch {
        response = null
      }
      if (isStopped()) return

      // Transient trouble is retried in place with backoff instead of
      // pausing the run: long enrichment loops outlive auth tokens and hit
      // the odd network blip, and a redone batch can only re-process songs
      // that never committed.
      if (response === null || isTransientStatus(response.status)) {
        const status = response === null ? null : response.status
        let detail: string | null = null
        let isSafeToRetry = false
        let isBilledFailure = false
        if (response !== null) {
          try {
            const body: unknown = await response.json()
            if (isRecord(body)) {
              detail = readString(body.message)
              isSafeToRetry = body.safeToRetry === true
              // Explicit false means the billable model call already ran —
              // an absent field (gateway errors, HTML bodies) stays ambiguous.
              isBilledFailure = body.safeToRetry === false
            }
          } catch {
            detail = null
          }
        }
        if (isStopped()) return

        // The server marks failures that happened before the billable model
        // call as safe to retry. Redoing those costs nothing, so ride them
        // out — a laptop wake or dropped uplink can run the better part of
        // an hour. Navigating away still aborts the loop.
        if (isSafeToRetry && safeRetries < MAX_SAFE_RETRIES) {
          safeRetries += 1
          retryDetail = detail ?? ''
          setState({ phase: 'running', processedThisRun, counts, retryDetail })
          setAnnouncement('Connection problem — retrying automatically.')
          await wait(transientDelayMs(safeRetries), signal)
          continue
        }

        transientFailures += 1
        if (isBilledFailure) billedFailures += 1
        if (
          !isSafeToRetry &&
          transientFailures < MAX_TRANSIENT_FAILURES &&
          billedFailures < MAX_BILLED_FAILURES
        ) {
          // An expired Supabase session surfaces as 401; rotating the
          // cookie here lets the retried call authenticate.
          if (status === 401) await createClient().auth.refreshSession()
          if (isStopped()) return
          setAnnouncement('Connection problem — retrying.')
          await wait(transientDelayMs(transientFailures), signal)
          continue
        }
        pauseWithError(
          status === null
            ? 'Network error — check your connection and retry.'
            : status === 401
              ? 'Your session expired. Reload the page and sign in again.'
              : detail === null
                ? 'Repeated server errors. Wait a moment and retry.'
                : `Repeated server errors: ${detail}`,
          'Enrichment paused by a connection problem.',
        )
        return
      }

      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (isStopped()) return

      const parsed = parseResponse(payload)
      if (parsed === null) {
        pauseWithError(
          'The server returned an unexpected response.',
          'Enrichment paused by an error.',
        )
        return
      }
      transientFailures = 0
      billedFailures = 0
      safeRetries = 0
      retryDetail = null

      if (parsed.status === 'error') {
        pauseWithError(parsed.message, 'Enrichment paused by an error.')
        return
      }

      if (parsed.status === 'done') {
        const finalCounts = toCounts(parsed)
        setState({ phase: 'done', counts: finalCounts })
        setAnnouncement(
          `Enrichment complete. ${finalCounts.enriched.toLocaleString()} songs enriched.`,
        )
        router.refresh()
        return
      }

      if (parsed.status === 'cap_reached') {
        setState({ phase: 'capReached', counts: toCounts(parsed) })
        setAnnouncement(
          'Enrichment paused at the per-run cap. Continue to keep going.',
        )
        router.refresh()
        return
      }

      counts = toCounts(parsed)
      processedThisRun += parsed.batchProcessed

      if (parsed.batchEnriched + parsed.batchUnknown === 0) {
        stalledBatches += 1
        if (stalledBatches >= MAX_STALLED_BATCHES) {
          pauseWithError(
            'Enrichment stalled — some songs could not be processed. Retry later.',
            'Enrichment stalled.',
          )
          return
        }
      } else {
        stalledBatches = 0
      }

      if (counts.total > 0) {
        const doneCount = counts.enriched + counts.unknown
        const decile = Math.min(Math.floor((doneCount / counts.total) * 10), 9)
        if (decile > lastDecile) {
          lastDecile = decile
          if (decile > 0) setAnnouncement(`${decile * 10}% enriched.`)
        }
      }

      // Refresh every batch: batches land tens of seconds apart, and this is
      // what makes attributes appear in the table as they land.
      router.refresh()
    }
  }

  const handleStart = () => {
    if (state.phase === 'error') {
      void runEnrichment(state.processedThisRun)
    } else {
      void runEnrichment(0)
    }
  }

  // Invisible for fully-enriched libraries, but keep post-run states visible
  // after router.refresh() zeroes pendingCount.
  if (state.phase === 'idle' && pendingCount === 0) return null

  if (models.length === 0) {
    return (
      <div className='mt-6 border-t border-border pt-6'>
        <p className='text-sm text-muted-foreground'>
          Enrichment is unavailable — no models are enabled.
        </p>
      </div>
    )
  }

  const isRunning = state.phase === 'running'
  const primaryLabel =
    state.phase === 'error'
      ? 'Retry'
      : state.phase === 'capReached'
        ? 'Continue enriching'
        : isRunning
          ? 'Enriching…'
          : `Enrich ${pendingCount.toLocaleString()} ${
              pendingCount === 1 ? 'song' : 'songs'
            }`

  const counts = state.phase === 'idle' ? null : state.counts

  const doneCount = counts === null ? null : counts.enriched + counts.unknown

  return (
    <div className='mt-6 flex flex-col gap-4 border-t border-border pt-6'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='flex flex-col gap-1.5'>
          <span
            className='text-xs font-medium text-muted-foreground'
            id={modelLabelId}
          >
            Model
          </span>
          <Select
            disabled={isRunning}
            items={models.map((model) => ({
              value: model.id,
              label: model.label,
            }))}
            value={modelId}
            onValueChange={(value) => {
              setModelId(value)
            }}
          >
            <SelectTrigger
              aria-labelledby={`${modelLabelId} ${modelTriggerId}`}
              className='min-w-56'
              id={modelTriggerId}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={isRunning || modelId === null} onClick={handleStart}>
          {primaryLabel}
        </Button>
      </div>

      {state.phase === 'idle' && totalCount > pendingCount && (
        <p className='text-sm text-muted-foreground tabular-nums'>
          {(totalCount - pendingCount).toLocaleString()} of{' '}
          {totalCount.toLocaleString()} songs already processed — the button
          enriches the rest.
        </p>
      )}

      {(state.phase === 'running' || state.phase === 'error') && (
        <div className='flex flex-col gap-2'>
          <Progress
            aria-label='Library enrichment progress'
            className='w-full max-w-md motion-reduce:[&_[data-slot=progress-indicator]]:transition-none'
            max={counts?.total ?? 100}
            value={counts === null || doneCount === null ? null : doneCount}
          />
          <p className='text-sm text-muted-foreground tabular-nums'>
            {counts === null || doneCount === null
              ? 'Preparing…'
              : `${doneCount.toLocaleString()} / ${counts.total.toLocaleString()} enriched${
                  counts.unknown > 0
                    ? ` · ${counts.unknown.toLocaleString()} unknown`
                    : ''
                }`}
          </p>
          {state.phase === 'running' && state.retryDetail !== null && (
            <p className='text-sm text-muted-foreground'>
              Connection problem — retrying automatically…
              {state.retryDetail === '' ? '' : ` (${state.retryDetail})`}
            </p>
          )}
        </div>
      )}

      {state.phase === 'error' && (
        <p className='text-sm text-destructive'>{state.message}</p>
      )}

      {state.phase === 'capReached' && (
        <p className='text-sm text-muted-foreground tabular-nums'>
          Paused at the per-run cap — {state.counts.pending.toLocaleString()}{' '}
          songs still pending.
        </p>
      )}

      {state.phase === 'done' && (
        <p className='text-sm text-muted-foreground tabular-nums'>
          Enrichment complete — {state.counts.enriched.toLocaleString()}{' '}
          enriched
          {state.counts.unknown > 0
            ? `, ${state.counts.unknown.toLocaleString()} unknown`
            : ''}{' '}
          of {totalCount.toLocaleString()} songs.
        </p>
      )}

      <div className='sr-only' role='status'>
        {announcement}
      </div>
    </div>
  )
}
