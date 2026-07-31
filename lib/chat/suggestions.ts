// Server-only prompt-suggestion generator. It reads the requester's effective
// library vocabulary through the RLS client and sends only sampled tag names
// to the configured chat model.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateText, Output } from 'ai'
import { z } from 'zod'

import { resolveChatModel } from '@/lib/ai/chat-model'
import {
  getLibraryTagSummary,
  type LibraryTag,
} from '@/lib/chat/library-search'
import type { Database } from '@/lib/supabase/types'

type Client = SupabaseClient<Database>

type PromptSuggestionsResult =
  { status: 'ok'; suggestions: string[] } | { status: 'error'; message: string }

const GENRE_SAMPLE_SIZE = 24
const MOOD_SAMPLE_SIZE = 18

const promptSuggestionsSchema = z.object({
  suggestions: z.array(z.string().trim().min(1).max(60)).length(3),
})

const sampleTagNames = (tags: LibraryTag[], limit: number): string[] => {
  const names = tags.map((tag) => tag.name)
  for (let index = names.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const current = names[index]
    names[index] = names[randomIndex]
    names[randomIndex] = current
  }
  return names.slice(0, limit)
}

/** Generate three short requests grounded in a sample of the user's tags. */
export const generatePromptSuggestions = async (
  supabase: Client,
): Promise<PromptSuggestionsResult> => {
  const modelResult = resolveChatModel()
  if (modelResult.status === 'error') return modelResult

  const summary = await getLibraryTagSummary(supabase)

  // Unlike the chat search prompt, suggestions never resolve tags themselves,
  // so sampling is safe here and keeps each browser session's ideas fresh.
  const genres = sampleTagNames(summary.genres, GENRE_SAMPLE_SIZE)
  const moods = sampleTagNames(summary.moods, MOOD_SAMPLE_SIZE)

  try {
    const { output } = await generateText({
      model: modelResult.model,
      output: Output.object({ schema: promptSuggestionsSchema }),
      instructions: `Generate exactly three different playlist ideas for the user's saved music library. Phrase each as a natural request the user could send to a playlist assistant. Ground every idea only in the provided genre and mood names, and draw on distinct parts of the vocabulary across the set. Keep each idea under 60 characters. Do not add a preamble or numbering.`,
      prompt: `Sampled genres from the user's library: ${JSON.stringify(genres)}\nSampled moods from the user's library: ${JSON.stringify(moods)}`,
    })
    return { status: 'ok', suggestions: output.suggestions }
  } catch (error) {
    console.error('[prompt-suggestions]', error)
    return { status: 'error', message: 'Could not generate suggestions' }
  }
}
