'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  ANALYSIS_BUDGET_COPY,
  ANALYSIS_SHARED_RESULT_COPY,
} from '@/lib/enrichment/confidence'
import {
  type EnrichBatchResponse,
  type EnrichmentCounts,
} from '@/lib/enrichment/engine'
import { type EnrichmentRecipeSummary } from '@/lib/enrichment/recipes'
import { isRecord, readNumber, readString } from '@/lib/json'
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
  <div className='flex min-w-28 flex-col border-s border-border ps-3'>
    <span className='text-xl font-semibold tabular-nums'>
      {count.toLocaleString()}
    </span>
    <span className='text-xs text-muted-foreground'>{label}</span>
  </div>
)

/**
 * Everything that makes one analysis differ from another, on one line: which
 * model, how hard it was asked to think, how many songs it weighs at once, and
 * the three versions that pin the prompt, the vocabulary, and the output shape.
 */
const describeRecipe = (recipe: EnrichmentRecipeSummary): string =>
  [
    `${recipe.provider}:${recipe.modelId}`,
    `${recipe.reasoningEffort} effort`,
    `${recipe.batchSize} songs per call`,
    `rank ${recipe.enrichmentRank}`,
    recipe.promptVersion,
    recipe.vocabularyVersion,
    recipe.identityVersion,
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

      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
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
          `${parsed.batchPromoted.toLocaleString()} shared ${parsed.batchPromoted === 1 ? 'analysis was' : 'analyses were'} improved.`,
        )
      } else if (parsed.batchRejected > 0) {
        setAnnouncement(
          'The checked candidates did not improve the shared analysis.',
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
        ? 'Resume analysis'
        : state.phase === 'capReached'
          ? 'Continue analysis'
          : isActive
            ? 'Analyzing…'
            : counts.eligible > 0
              ? `Analyze & improve ${counts.eligible.toLocaleString()}`
              : 'Confidence up to date'

  return (
    <section
      aria-labelledby='library-confidence-heading'
      className='mt-6 flex flex-col gap-4 border-t border-border pt-6'
    >
      <div className='flex flex-col gap-1'>
        <h2 className='text-sm font-semibold' id='library-confidence-heading'>
          Confidence
        </h2>
        <p className='max-w-prose text-sm text-muted-foreground'>
          Confidence is reported by the model, not measured accuracy.{' '}
          {ANALYSIS_SHARED_RESULT_COPY} {ANALYSIS_BUDGET_COPY}
        </p>
      </div>

      <div className='flex flex-wrap gap-x-3 gap-y-3'>
        <SummaryCount count={counts.pending} label='Pending' />
        <SummaryCount count={counts.none} label='None' />
        <SummaryCount count={counts.low} label='Low' />
        <SummaryCount count={counts.medium} label='Medium' />
        <SummaryCount count={counts.high} label='High' />
      </div>

      <div className='flex flex-wrap items-center gap-3'>
        <Button
          disabled={isActive || counts.eligible === 0}
          onClick={handleStart}
        >
          {primaryLabel}
        </Button>
        {isActive && (
          <Button disabled={isPausing} variant='outline' onClick={handlePause}>
            {isPausing ? 'Pausing…' : 'Pause'}
          </Button>
        )}
        {counts.queued > 0 && (
          <p className='text-sm text-muted-foreground tabular-nums'>
            {counts.queued.toLocaleString()} queued
          </p>
        )}
      </div>

      {currentRecipe !== null && (
        <div className='flex flex-col gap-0.5 text-xs text-muted-foreground'>
          <p>
            Analyzing with{' '}
            <span className='font-medium text-foreground'>
              {currentRecipe.label}
            </span>
            {currentRecipe.canEnrichAllSongs &&
              ' — this recipe also revisits High songs'}
          </p>
          <p>{describeRecipe(currentRecipe)}</p>
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
          <Progress
            aria-label='Library confidence progress'
            className='w-full max-w-md motion-reduce:[&_[data-slot=progress-indicator]]:transition-none'
            max={counts.total}
            value={analyzed}
          />
          <p className='text-sm text-muted-foreground tabular-nums'>
            {analyzed.toLocaleString()} / {counts.total.toLocaleString()}{' '}
            analyzed
          </p>
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
