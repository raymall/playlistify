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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const readString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

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
 * the active-ref + AbortController checked after every await. Enrichment
 * never starts on its own.
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
  const isActiveRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    isActiveRef.current = true
    return () => {
      isActiveRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const runEnrichment = async (startProcessed: number) => {
    if (modelId === null) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    // Unmount/abort can flip these mid-await; funnelling through a call keeps
    // each check live against TypeScript's flow narrowing.
    const isStopped = () => !isActiveRef.current || signal.aborted

    let processedThisRun = startProcessed
    let counts: EnrichmentCounts | null = null
    let lastDecile = -1
    let stalledBatches = 0

    setAnnouncement('Enrichment started.')

    while (!isStopped()) {
      setState({ phase: 'running', processedThisRun, counts })

      let response: Response
      try {
        response = await fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, processedSoFar: processedThisRun }),
          signal,
        })
      } catch {
        if (isStopped()) return
        setState({
          phase: 'error',
          processedThisRun,
          message: 'Network error — check your connection and retry.',
          counts,
        })
        setAnnouncement('Enrichment paused by a network error.')
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
          processedThisRun,
          message: 'The server returned an unexpected response.',
          counts,
        })
        setAnnouncement('Enrichment paused by an error.')
        return
      }

      if (parsed.status === 'error') {
        setState({
          phase: 'error',
          processedThisRun,
          message: parsed.message,
          counts,
        })
        setAnnouncement('Enrichment paused by an error.')
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
          setState({
            phase: 'error',
            processedThisRun,
            message:
              'Enrichment stalled — some songs could not be processed. Retry later.',
            counts,
          })
          setAnnouncement('Enrichment stalled.')
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
