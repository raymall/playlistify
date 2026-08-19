import { z } from 'zod'

/**
 * Below this (rounded) confidence a song is marked `unknown` and gets no
 * attributes or tag links. Mirrored in scripts/verify-enrichment.mjs.
 */
export const CONFIDENCE_THRESHOLD = 0.4

/**
 * The bounded output parameters a recipe snapshot stores — never raw JSON
 * Schema, so the database cannot inject an arbitrary shape into a billed API
 * call. Strict: an unknown key means a spec this build does not understand,
 * and the batch is released rather than guessed at.
 */
const enrichmentOutputSpecSchema = z
  .strictObject({
    maxGenres: z.number().int().min(0).max(10),
    maxMoods: z.number().int().min(0).max(10),
    maxInstrumentation: z.number().int().min(0).max(12),
    maxDescriptors: z.number().int().min(0).max(16),
    energyMin: z.number().int().min(1).max(9),
    energyMax: z.number().int().min(1).max(9),
    tempoFeels: z.tuple([z.string().min(1)], z.string().min(1)),
  })
  .refine((spec) => spec.energyMin <= spec.energyMax, {
    message: 'energyMin must not exceed energyMax',
  })
  .refine((spec) => spec.tempoFeels.length <= 8, {
    message: 'tempoFeels is capped at 8 options',
  })

export type EnrichmentOutputSpec = z.infer<typeof enrichmentOutputSpecSchema>

/** Defensive parse of a recipe's `output_spec` jsonb; null = unsupported. */
export const readEnrichmentOutputSpec = (
  value: unknown,
): EnrichmentOutputSpec | null => {
  const parsed = enrichmentOutputSpecSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * One batch in the LLM's structured output, shaped by the claimed recipe's
 * spec. `spotify_track_id` echoes the input id so results can be matched
 * back; every field is required (OpenAI strict structured outputs reject
 * optional keys).
 */
export const buildEnrichmentBatchSchema = (spec: EnrichmentOutputSpec) => {
  const [firstTempoFeel, ...restTempoFeels] = spec.tempoFeels
  return z.object({
    songs: z.array(
      z.object({
        spotify_track_id: z.string(),
        confidence: z.number().min(0).max(1),
        genres: z.array(z.string()).max(spec.maxGenres),
        moods: z.array(z.string()).max(spec.maxMoods),
        energy: z.number().int().min(spec.energyMin).max(spec.energyMax),
        tempo_feel: z.enum([firstTempoFeel, ...restTempoFeels]),
        era: z.string(),
        instrumentation: z.array(z.string()).max(spec.maxInstrumentation),
        descriptors: z.array(z.string()).max(spec.maxDescriptors),
      }),
    ),
  })
}

export type EnrichedSong = z.infer<
  ReturnType<typeof buildEnrichmentBatchSchema>
>['songs'][number]

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
