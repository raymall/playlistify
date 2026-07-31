'use client'

import { useEffect, useState } from 'react'

import { isRecord } from '@/lib/json'

const STORAGE_KEY = 'playlistify:prompt-suggestions:v1'

type PromptSuggestionsState =
  | { status: 'loading' }
  | { status: 'ready'; suggestions: readonly string[] }
  | { status: 'unavailable' }

const readPromptSuggestions = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length !== 3) return null

  const suggestions: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const suggestion = entry.trim()
    if (suggestion.length === 0) return null
    suggestions.push(suggestion)
  }
  return suggestions
}

const readCachedSuggestions = (): string[] | null => {
  try {
    const cached = sessionStorage.getItem(STORAGE_KEY)
    return cached === null ? null : readPromptSuggestions(JSON.parse(cached))
  } catch {
    return null
  }
}

const readResponseSuggestions = (value: unknown): string[] | null => {
  if (!isRecord(value) || value.status !== 'ok') return null
  return readPromptSuggestions(value.suggestions)
}

export const usePromptSuggestions = (): PromptSuggestionsState => {
  const [state, setState] = useState<PromptSuggestionsState>({
    status: 'loading',
  })

  useEffect(() => {
    const cached = readCachedSuggestions()
    if (cached !== null) {
      const timeoutId = window.setTimeout(() => {
        setState({ status: 'ready', suggestions: cached })
      }, 0)
      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    const controller = new AbortController()
    const markUnavailable = () => {
      if (!controller.signal.aborted) {
        setState({ status: 'unavailable' })
      }
    }
    const loadSuggestions = async () => {
      try {
        const response = await fetch('/api/prompt-suggestions', {
          signal: controller.signal,
        })
        if (!response.ok) {
          markUnavailable()
          return
        }

        const generatedSuggestions = readResponseSuggestions(
          await response.json(),
        )
        if (generatedSuggestions === null) {
          markUnavailable()
          return
        }
        if (controller.signal.aborted) return

        setState({ status: 'ready', suggestions: generatedSuggestions })
        try {
          sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(generatedSuggestions),
          )
        } catch {
          // Storage can be unavailable; the generated suggestions still work.
        }
      } catch {
        markUnavailable()
      }
    }

    // Deferring one task avoids a duplicate request during React's development
    // setup/cleanup check: the first setup's timer is cleared before it fires.
    const timeoutId = window.setTimeout(() => void loadSuggestions(), 0)
    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [])

  return state
}
