'use client'

import { useEffect, useState } from 'react'

import { isRecord } from '@/lib/json'

export const FALLBACK_PROMPTS = [
  'Upbeat indie for a morning run',
  'Mellow late-night jazz and soul',
  'High-energy 2000s hip-hop, no explicit tracks',
] as const

const STORAGE_KEY = 'playlistify:prompt-suggestions:v1'

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

export const usePromptSuggestions = (): readonly string[] => {
  const [suggestions, setSuggestions] =
    useState<readonly string[]>(FALLBACK_PROMPTS)

  useEffect(() => {
    const cached = readCachedSuggestions()
    if (cached !== null) {
      const timeoutId = window.setTimeout(() => {
        setSuggestions(cached)
      }, 0)
      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    const controller = new AbortController()
    const loadSuggestions = async () => {
      try {
        const response = await fetch('/api/prompt-suggestions', {
          signal: controller.signal,
        })
        if (!response.ok) return

        const suggestions = readResponseSuggestions(await response.json())
        if (suggestions === null || controller.signal.aborted) return

        setSuggestions(suggestions)
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(suggestions))
        } catch {
          // Storage can be unavailable; the generated suggestions still work.
        }
      } catch {
        // Suggestions are optional; keep the static fallback silently.
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

  return suggestions
}
