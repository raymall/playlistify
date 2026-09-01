'use client'

import { SparklesIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  type EnrichBatchResponse,
  type EnrichmentCounts,
} from '@/lib/enrichment/engine'
import { type EnrichmentRecipeSummary } from '@/lib/enrichment/recipes'
import { isRecord, readJson, readNumber, readString } from '@/lib/json'
import { wait } from '@/lib/sleep'
import { createClient } from '@/lib/supabase/client'

type LibraryEnrichmentPanelProps = {
  initialCounts: EnrichmentCounts
  recipes: EnrichmentRecipeSummary[]
}

type ActiveAnalysisState = {
  processedThisRun: number
  counts: EnrichmentCounts
  retryDetail: string | null
}

type AnalysisState =
  | { phase: 'idle'; counts: EnrichmentCounts }
  | ({ phase: 'running' | 'pausing' | 'paused' } & ActiveAnalysisState)
  | { phase: 'capReached'; counts: EnrichmentCounts }
  | {
      phase: 'error'
      processedThisRun: number
      message: string
      counts: EnrichmentCounts
    }
  | { phase: 'done'; counts: EnrichmentCounts }

const MAX_TRANSIENT_FAILURES = 8
const MAX_BILLED_FAILURES = 2
const MAX_SAFE_RETRIES = 120

const transientDelayMs = (failures: number) =>
  Math.min(15000, 1000 * 2 ** (failures - 1))

const isTransientStatus = (status: number) =>
  status === 401 || status === 408 || status === 429 || status >= 500

const readCounts = (
  value: Record<string, unknown>,
): EnrichmentCounts | null => {
  const total = readNumber(value.total)
  const pending = readNumber(value.pending)
  const none = readNumber(value.none)
  const low = readNumber(value.low)
  const medium = readNumber(value.medium)
  const high = readNumber(value.high)
  const queued = readNumber(value.queued)
  const ineligibleWeak = readNumber(value.ineligibleWeak)
  const eligible = readNumber(value.eligible)
  if (
    total === null ||
    pending === null ||
    none === null ||
    low === null ||
    medium === null ||
    high === null ||
    queued === null ||
    ineligibleWeak === null ||
    eligible === null
  ) {
    return null
  }
  return {
    total,
    pending,
    none,
    low,
    medium,
    high,
    queued,
    ineligibleWeak,
    eligible,
  }
}

const parseResponse = (value: unknown): EnrichBatchResponse | null => {
  if (!isRecord(value)) return null
  const { status } = value
  if (status === 'progress') {
    const counts = readCounts(value)
    const batchProcessed = readNumber(value.batchProcessed)
    const batchPromoted = readNumber(value.batchPromoted)
    const batchRejected = readNumber(value.batchRejected)
    const batchOmitted = readNumber(value.batchOmitted)
    if (
      counts === null ||
      batchProcessed === null ||
      batchPromoted === null ||
      batchRejected === null ||
      batchOmitted === null
    ) {
      return null
    }
    return {
      status,
      batchProcessed,
      batchPromoted,
      batchRejected,
      batchOmitted,
      ...counts,
    }
  }
  if (status === 'done' || status === 'cap_reached') {
    const counts = readCounts(value)
    return counts === null ? null : { status, ...counts }
  }
  if (status === 'waiting') {
    const counts = readCounts(value)
    const retryAfterMs = readNumber(value.retryAfterMs)
    if (counts === null || retryAfterMs === null) return null
    return { status, retryAfterMs, ...counts }
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

const SummaryCount = ({ count, label }: { count: number; label: string }) => (
  <div className='flex min-w-0 flex-col items-center border-s-2 border-border px-1 py-1 text-center first:border-s-0 sm:px-4'>
    <span className='font-display text-xl leading-none tabular-nums sm:text-2xl'>
      {count.toLocaleString()}
    </span>
    <span className='mt-1 font-mono text-[0.625rem] tracking-[0.04em] text-muted-foreground uppercase sm:text-[0.6875rem] sm:tracking-[0.08em]'>
      {label}
    </span>
  </div>
)

/**
 * Everything that makes one analysis differ from another, on one line: which
 * model, how hard it was asked to think, how many songs it weighs at once, and
 * the snapshot hash that pins the prompt, the identity, the output shape, and
 * the frozen vocabulary.
 */
const describeRecipe = (recipe: EnrichmentRecipeSummary): string =>
  [
    `${recipe.provider}:${recipe.modelId}`,
    `${recipe.reasoningEffort} effort`,
    `${recipe.batchSize} songs per call`,
    `rank ${recipe.enrichmentRank}`,
    `snapshot ${recipe.contentHash.slice(0, 12)}`,
  ].join(' · ')

export const LibraryEnrichmentPanel = ({
  initialCounts,
  recipes,
}: LibraryEnrichmentPanelProps) => {
  const router = useRouter()
  const [state, setState] = useState<AnalysisState>({
    phase: 'idle',
    counts: initialCounts,
  })
  const [previousInitialCounts, setPreviousInitialCounts] =
    useState(initialCounts)
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const isRequestInFlightRef = useRef(false)
  const isPauseRequestedRef = useRef(false)

  useEffect(() => () => abortRef.current?.abort(), [])

  if (previousInitialCounts !== initialCounts) {
    setPreviousInitialCounts(initialCounts)
    if (state.phase === 'idle' || state.phase === 'done') {
      setState({ phase: 'idle', counts: initialCounts })
    }
  }

  const runAnalysis = async (startProcessed: number, isResuming = false) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    isRequestInFlightRef.current = false
    isPauseRequestedRef.current = false
    const { signal } = controller
    const isStopped = () => signal.aborted
    const isPauseRequested = () => isPauseRequestedRef.current

    let processedThisRun = startProcessed
    let counts = state.counts
    let transientFailures = 0
    let billedFailures = 0
    let safeRetries = 0
    let retryDetail: string | null = null

    const pauseRun = () => {
      setState({
        phase: 'paused',
        processedThisRun,
        counts,
        retryDetail,
      })
      setAnnouncement('Analysis paused.')
    }

    const pauseWithError = (message: string) => {
      setState({
        phase: 'error',
        processedThisRun,
        message,
        counts,
      })
      setAnnouncement('Analysis paused by an error.')
    }

    setAnnouncement(isResuming ? 'Analysis resumed.' : 'Analysis started.')

    while (!isStopped()) {
      setState({
        phase: 'running',
        processedThisRun,
        counts,
        retryDetail,
      })

      let response: Response | null
      isRequestInFlightRef.current = true
      try {
        response = await fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ processedSoFar: processedThisRun }),
          signal,
        })
      } catch {
        response = null
      }
      if (response === null) isRequestInFlightRef.current = false
      if (isStopped()) return

      if (response === null || isTransientStatus(response.status)) {
        const responseStatus = response?.status ?? null
        let detail: string | null = null
        let isSafeToRetry = false
        let isBilledFailure = false
        if (response !== null) {
          try {
            const body: unknown = await response.json()
            if (isRecord(body)) {
              detail = readString(body.message)
              isSafeToRetry = body.safeToRetry === true
              isBilledFailure = body.safeToRetry === false
            }
          } catch {
            detail = null
          }
        }
        isRequestInFlightRef.current = false
        if (isStopped()) return

        if (isSafeToRetry && safeRetries < MAX_SAFE_RETRIES) {
          safeRetries += 1
          retryDetail = detail ?? ''
          if (isPauseRequested()) {
            pauseRun()
            return
          }
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
          if (isPauseRequested()) {
            retryDetail = detail
            pauseRun()
            return
          }
          if (responseStatus === 401) {
            await createClient().auth.refreshSession()
          }
          if (isStopped()) return
          setAnnouncement('Connection problem — retrying.')
          await wait(transientDelayMs(transientFailures), signal)
          continue
        }

        pauseWithError(
          responseStatus === null
            ? 'Network error — check your connection and retry.'
            : responseStatus === 401
              ? 'Your session expired. Reload and sign in again.'
              : detail === null
                ? 'Repeated server errors. Wait a moment and retry.'
                : `Repeated server errors: ${detail}`,
        )
        return
      }

      const payload = await readJson(response)
      isRequestInFlightRef.current = false
      if (isStopped()) return

      const parsed = parseResponse(payload)
      if (parsed === null) {
        pauseWithError('The server returned an unexpected response.')
        return
      }
      transientFailures = 0
      billedFailures = 0
      safeRetries = 0
      retryDetail = null

      if (parsed.status === 'error') {
        pauseWithError(parsed.message)
        return
      }

      counts = parsed
      if (parsed.status === 'waiting') {
        if (isPauseRequested()) {
          pauseRun()
          return
        }
        setAnnouncement('Queued analysis is waiting for an available worker.')
        await wait(parsed.retryAfterMs, signal)
        continue
      }
      if (parsed.status === 'done') {
        setState({ phase: 'done', counts })
        setAnnouncement('Confidence is up to date.')
        router.refresh()
        return
      }
      if (parsed.status === 'cap_reached') {
        setState({ phase: 'capReached', counts })
        setAnnouncement(
          'Analysis paused at the per-run cap. Continue when ready.',
        )
        router.refresh()
        return
      }

      processedThisRun += parsed.batchProcessed
      if (parsed.batchPromoted > 0) {
        setAnnouncement(
          `${parsed.batchPromoted.toLocaleString()} shared ${parsed.batchPromoted === 1 ? 'analysis was' : 'analyses were'} enriched.`,
        )
      } else if (parsed.batchRejected > 0) {
        setAnnouncement(
          'The checked candidates did not enrich the shared analysis.',
        )
      }
      router.refresh()

      if (isPauseRequested()) {
        pauseRun()
        return
      }
    }
  }

  const handleStart = () => {
    if (state.phase === 'paused') {
      void runAnalysis(state.processedThisRun, true)
    } else if (state.phase === 'error') {
      void runAnalysis(state.processedThisRun)
    } else {
      void runAnalysis(0)
    }
  }

  const handlePause = () => {
    if (state.phase !== 'running') return
    isPauseRequestedRef.current = true
    if (isRequestInFlightRef.current) {
      setState({ ...state, phase: 'pausing' })
      setAnnouncement(
        'Pause requested. The current analysis attempt will finish first.',
      )
      return
    }
    abortRef.current?.abort()
    setState({ ...state, phase: 'paused' })
    setAnnouncement('Analysis paused.')
  }

  const { counts } = state
  const currentRecipe = recipes.find((recipe) => recipe.isCurrent) ?? null
  const escalations = recipes.filter(
    (recipe) => !recipe.isCurrent && recipe.escalatingSongs > 0,
  )
  const isRunning = state.phase === 'running'
  const isPausing = state.phase === 'pausing'
  const isActive = isRunning || isPausing
  const analyzed = counts.none + counts.low + counts.medium + counts.high
  const primaryLabel =
    state.phase === 'error'
      ? 'Retry'
      : state.phase === 'paused'
        ? 'Resume enrichment'
        : state.phase === 'capReached'
          ? 'Continue enrichment'
          : isActive
            ? 'Enriching…'
            : counts.eligible > 0
              ? 'Enrich'
              : 'Confidence up to date'

  return (
    <section
      aria-busy={isActive}
      aria-label='Library analysis status'
      className='flex flex-col gap-6'
    >
      {currentRecipe !== null && (
        <div className='min-w-0 bg-muted px-5 py-4 sm:px-6'>
          <p className='font-display text-2xl leading-none tracking-[-0.035em] sm:text-3xl'>
            {currentRecipe.label}
          </p>
          <p className='editorial-kicker mt-2 truncate text-muted-foreground'>
            Current recipe / {describeRecipe(currentRecipe)}
          </p>
        </div>
      )}

      <div className='grid w-full grid-cols-5'>
        <SummaryCount count={counts.pending} label='Pending' />
        <SummaryCount count={counts.none} label='None' />
        <SummaryCount count={counts.low} label='Low' />
        <SummaryCount count={counts.medium} label='Medium' />
        <SummaryCount count={counts.high} label='High' />
      </div>

      <div className='grid gap-4 border-y-2 border-border py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center'>
        <div className='flex min-w-0 flex-col gap-2'>
          <div className='flex items-center justify-between gap-4 font-mono text-xs tabular-nums'>
            <span>{analyzed.toLocaleString()} enriched</span>
            <span className='text-muted-foreground'>
              {counts.total.toLocaleString()} total
            </span>
          </div>
          <Progress
            aria-label='Library confidence progress'
            aria-valuetext={`${analyzed.toLocaleString()} enriched out of ${counts.total.toLocaleString()}${isActive ? '; enrichment in progress' : ''}`}
            className='library-enrichment-progress w-full [&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-indicator]]:bg-control motion-reduce:[&_[data-slot=progress-indicator]]:transition-none [&_[data-slot=progress-track]]:h-2'
            data-active={isActive}
            max={counts.total}
            value={analyzed}
          />
        </div>
        <div className='flex w-full flex-col items-center gap-3 sm:flex-row lg:justify-end'>
          <Button
            className='w-full sm:w-auto sm:min-w-56'
            disabled={isActive || counts.eligible === 0}
            size='lg'
            onClick={handleStart}
          >
            <SparklesIcon aria-hidden='true' data-icon='inline-start' />
            {primaryLabel}
          </Button>
          {isActive && (
            <Button
              className='w-full sm:w-auto'
              disabled={isPausing}
              variant='outline'
              onClick={handlePause}
            >
              {isPausing ? 'Pausing…' : 'Pause'}
            </Button>
          )}
        </div>
      </div>

      {currentRecipe !== null && escalations.length > 0 && (
        <div className='flex flex-col gap-0.5 text-xs text-muted-foreground'>
          {escalations.map((recipe) => (
            <p key={recipe.recipeId} className='tabular-nums'>
              {recipe.escalatingSongs.toLocaleString()}{' '}
              {recipe.escalatingSongs === 1 ? 'song moves' : 'songs move'} up to{' '}
              <span className='font-medium text-foreground'>
                {recipe.label}
              </span>{' '}
              (rank {recipe.enrichmentRank}) on the next run.
            </p>
          ))}
        </div>
      )}

      {(isActive || state.phase === 'paused' || state.phase === 'error') && (
        <div className='flex flex-col gap-2'>
          {isPausing && (
            <p className='text-sm text-muted-foreground'>
              Finishing the current attempt before pausing…
            </p>
          )}
          {isRunning && state.retryDetail !== null && (
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
      {state.phase === 'paused' && (
        <p className='text-sm text-muted-foreground'>
          Analysis paused — resume when you’re ready.
        </p>
      )}
      {state.phase === 'capReached' && (
        <p className='text-sm text-muted-foreground'>
          Paused at the per-run cost cap.
        </p>
      )}
      {counts.ineligibleWeak > 0 && !isActive && (
        <p className='text-sm text-muted-foreground tabular-nums'>
          {counts.ineligibleWeak.toLocaleString()}{' '}
          {counts.ineligibleWeak === 1 ? 'song has' : 'songs have'} used every
          try at the current quality level, and{' '}
          {counts.ineligibleWeak === 1 ? 'waits' : 'wait'} until a better
          analysis is available.
        </p>
      )}

      <div aria-live='polite' className='sr-only' role='status'>
        {announcement}
      </div>
    </section>
  )
}
