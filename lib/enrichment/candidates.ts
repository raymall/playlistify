import {
  CONFIDENCE_THRESHOLD,
  type EnrichedSong,
  type SongAIAttributes,
} from '@/lib/enrichment/schema'
import { isValidTagName, normalizeTagName } from '@/lib/vocabulary'

export type CandidateOutcome =
  | {
      outcome: 'recognized'
      confidence: number
      aiAttributes: SongAIAttributes
      genreNames: string[]
      moodNames: string[]
    }
  | {
      outcome: 'unknown'
      confidence: number
      aiAttributes: null
      genreNames: []
      moodNames: []
    }
  | {
      outcome: 'omitted' | 'failed'
      confidence: null
      aiAttributes: null
      genreNames: []
      moodNames: []
    }

export const normalizeCandidateTagList = (names: string[]): string[] => {
  const seen = new Set<string>()
  for (const raw of names) {
    const name = normalizeTagName(raw)
    if (isValidTagName(name)) seen.add(name)
  }
  return [...seen]
}

export const roundRecognitionConfidence = (value: number): number =>
  Math.min(1, Math.max(0, Math.round(value * 100) / 100))

/** Off-list names are dropped outright — matching is exact, never snapped. */
const keepApproved = (names: string[], approved: Set<string>) =>
  names.filter((name) => approved.has(name))

export const normalizeCandidate = (
  entry: EnrichedSong,
  approvedGenres: Set<string>,
  approvedMoods: Set<string>,
): CandidateOutcome => {
  const confidence = roundRecognitionConfidence(entry.confidence)
  const genreNames = keepApproved(
    normalizeCandidateTagList(entry.genres),
    approvedGenres,
  )
  const moodNames = keepApproved(
    normalizeCandidateTagList(entry.moods),
    approvedMoods,
  )

  if (
    confidence < CONFIDENCE_THRESHOLD ||
    (genreNames.length === 0 && moodNames.length === 0)
  ) {
    return {
      outcome: 'unknown',
      confidence,
      aiAttributes: null,
      genreNames: [],
      moodNames: [],
    }
  }

  return {
    outcome: 'recognized',
    confidence,
    aiAttributes: {
      energy: entry.energy,
      tempo_feel: entry.tempo_feel,
      era: entry.era,
      instrumentation: entry.instrumentation,
      descriptors: entry.descriptors,
    },
    genreNames,
    moodNames,
  }
}

export const omittedCandidate = (): CandidateOutcome => ({
  outcome: 'omitted',
  confidence: null,
  aiAttributes: null,
  genreNames: [],
  moodNames: [],
})

export const failedCandidate = (): CandidateOutcome => ({
  outcome: 'failed',
  confidence: null,
  aiAttributes: null,
  genreNames: [],
  moodNames: [],
})
