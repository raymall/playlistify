import { z } from 'zod'

/**
 * Below this (rounded) confidence a song is marked `unknown` and gets no
 * attributes or tag links. Mirrored in scripts/verify-enrichment.mjs.
 */
export const CONFIDENCE_THRESHOLD = 0.4

/**
 * One song in the LLM's structured output. `spotify_track_id` echoes the
 * input id so results can be matched back; every field is required (OpenAI
 * strict structured outputs reject optional keys).
 */
const enrichedSongSchema = z.object({
  spotify_track_id: z.string(),
  confidence: z.number().min(0).max(1),
  genres: z.array(z.string()).max(4),
  moods: z.array(z.string()).max(5),
  energy: z.number().int().min(1).max(5),
  tempo_feel: z.enum(['slow', 'mid', 'fast']),
  era: z.string(),
  instrumentation: z.array(z.string()).max(6),
  descriptors: z.array(z.string()).max(8),
})

export const enrichmentBatchSchema = z.object({
  songs: z.array(enrichedSongSchema),
})

export type EnrichedSong = z.infer<typeof enrichedSongSchema>

/**
 * The subset persisted into `songs.ai_attributes`. Genres and moods are not
 * here on purpose — they live in the vocabulary link tables.
 */
const songAIAttributesSchema = z.object({
  energy: z.number(),
  tempo_feel: z.string(),
  era: z.string(),
  instrumentation: z.array(z.string()),
  descriptors: z.array(z.string()),
})

export type SongAIAttributes = z.infer<typeof songAIAttributesSchema>

/** Defensive parse of the jsonb column for view code. */
export const readSongAIAttributes = (
  value: unknown,
): SongAIAttributes | null => {
  const parsed = songAIAttributesSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
