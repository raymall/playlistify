'use client'

import { useEffect, useState } from 'react'

import { isRecord, readNumber, readString } from '@/lib/json'
import { MIN_TAG_QUERY_LENGTH } from '@/lib/library/search-params'
import { readTagKind, type TagKind } from '@/lib/tags'
import { normalizeTagName } from '@/lib/vocabulary'

export type TagSuggestion = {
  kind: TagKind
  name: string
  songCount: number
  isCapped: boolean
}

export type TagSuggestionsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; suggestions: readonly TagSuggestion[] }
  | { status: 'unavailable' }

const DEBOUNCE_MS = 250

/**
 * Bounded by query count, not by vocabulary size — the deliberate contrast to
 * the whole-vocabulary fetch this replaces. Prefix typing hits the same keys
 * constantly ("roc" → "rock" → backspace → "roc"), so even a small map pays.
 */
const CACHE_LIMIT = 50

const cache = new Map<string, readonly TagSuggestion[]>()

const remember = (key: string, suggestions: readonly TagSuggestion[]) => {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, suggestions)
}

const readSuggestion = (value: unknown): TagSuggestion | null => {
  if (!isRecord(value)) return null
  const kind = readTagKind(value.kind)
  const name = readString(value.name)
  const songCount = readNumber(value.songCount)
  if (kind === null || name === null || songCount === null) return null
  if (typeof value.isCapped !== 'boolean') return null
  return { kind, name, songCount, isCapped: value.isCapped }
}

const readSuggestionsResponse = (value: unknown): TagSuggestion[] | null => {
  if (!isRecord(value) || value.status !== 'ok') return null
  if (!Array.isArray(value.suggestions)) return null

  const suggestions: TagSuggestion[] = []
  for (const entry of value.suggestions) {
    const suggestion = readSuggestion(entry)
    if (suggestion === null) return null
    suggestions.push(suggestion)
  }
  return suggestions
}

/**
 * What a query resolves to before any request is made: nothing worth showing
 * below the minimum length, and an instant answer on a cache hit.
 */
const resolveKnown = (needle: string): TagSuggestionsState => {
  if (needle.length < MIN_TAG_QUERY_LENGTH) return { status: 'idle' }
  const cached = cache.get(needle)
  return cached === undefined
    ? { status: 'idle' }
    : { status: 'ready', suggestions: cached }
}

/**
 * Debounced, abortable tag typeahead against /api/library/tag-suggestions.
 *
 * The effect cleanup *is* the debounce: each keystroke changes the effect key,
 * which tears down the pending timer and schedules a new one. That also makes
 * it StrictMode-correct — the first setup's timer is cleared before it fires,
 * so the development setup/cleanup check never doubles a request.
 *
 * The too-short and cache-hit answers are adjusted during render rather than
 * set from the effect, which keeps the effect free of synchronous setState and
 * its cascading re-render.
 */
export const useTagSuggestions = (query: string): TagSuggestionsState => {
  const needle = normalizeTagName(query)
  const [state, setState] = useState<TagSuggestionsState>(() =>
    resolveKnown(needle),
  )
  const [prevNeedle, setPrevNeedle] = useState(needle)
  if (prevNeedle !== needle) {
    setPrevNeedle(needle)
    setState(resolveKnown(needle))
  }

  useEffect(() => {
    if (needle.length < MIN_TAG_QUERY_LENGTH || cache.has(needle)) return

    const controller = new AbortController()
    const markUnavailable = () => {
      if (!controller.signal.aborted) setState({ status: 'unavailable' })
    }

    const load = async () => {
      try {
        const response = await fetch(
          `/api/library/tag-suggestions?q=${encodeURIComponent(needle)}`,
          { signal: controller.signal },
        )
        if (!response.ok) {
          markUnavailable()
          return
        }

        const suggestions = readSuggestionsResponse(await response.json())
        if (controller.signal.aborted) return
        if (suggestions === null) {
          markUnavailable()
          return
        }

        remember(needle, suggestions)
        setState({ status: 'ready', suggestions })
      } catch {
        markUnavailable()
      }
    }

    // Loading is set when the timer fires, not on the keystroke, so a fast
    // typist never sees a flickering spinner.
    const timeoutId = window.setTimeout(() => {
      setState({ status: 'loading' })
      void load()
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [needle])

  return state
}
