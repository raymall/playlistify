import { generateText, Output } from 'ai'

import { type LlmModel, toEnrichmentModelString } from '@/lib/ai/models'
import { resolveLanguageModel } from '@/lib/ai/providers'
import {
  CONFIDENCE_THRESHOLD,
  type EnrichedSong,
  enrichmentBatchSchema,
  type SongAIAttributes,
} from '@/lib/enrichment/schema'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Tables, TablesInsert } from '@/lib/supabase/types'
import {
  isValidTagName,
  matchApprovedVocabulary,
  normalizeTagName,
} from '@/lib/vocabulary'

/** Client → route request body. `modelId` is an llm_models row uuid. */
export interface EnrichBatchPayload {
  modelId: string
  processedSoFar: number
}

/** Library-wide counts for the requesting user; total = sum of the rest. */
export interface EnrichmentCounts {
  total: number
  enriched: number
  unknown: number
  pending: number
}

/**
 * Route → client response. HTTP 200 for every non-error status; the client
 * parses this one union. `safeToRetry` marks failures that happened before
 * the billable model call — redoing those costs nothing, so the client rides
 * them out indefinitely instead of burning its bounded retry budget.
 */
export type EnrichBatchResponse =
  | ({
      status: 'progress'
      batchProcessed: number
      batchEnriched: number
      batchUnknown: number
    } & EnrichmentCounts)
  | ({ status: 'done' } & EnrichmentCounts)
  | ({ status: 'cap_reached' } & EnrichmentCounts)
  | { status: 'error'; message: string; safeToRetry?: boolean }

const DEFAULT_BATCH_SIZE = 20
const MIN_BATCH_SIZE = 1
const MAX_BATCH_SIZE = 50
const DEFAULT_MAX_SONGS_PER_RUN = 500
const MIN_MAX_SONGS_PER_RUN = 1
const MAX_MAX_SONGS_PER_RUN = 5000

const SYSTEM_PROMPT = `You are a music-metadata expert. For each numbered song in the user message, return one entry in "songs" with every schema field:

- spotify_track_id: echo the id exactly as given.
- confidence: 0-1, how certain you are that you know this exact recording.
- genres (max 4) and moods (max 5): choose ONLY from the approved vocabulary lists in the user message, copying each tag verbatim. Never invent, translate, combine, or add a tag that is not on the lists — off-list tags are discarded. If nothing on a list fits, return fewer tags or none. Genres describe the musical style; moods the emotional feel.
- energy: 1 (calm) to 5 (intense).
- tempo_feel: slow, mid, or fast.
- era: the decade or scene the recording belongs to, e.g. "1990s".
- instrumentation (max 6): prominent instruments or production elements.
- descriptors (max 8): short free-form qualities, e.g. "driving", "lo-fi".

If you do not recognize a song with reasonable certainty, set confidence below 0.4, return empty arrays for genres, moods, instrumentation, and descriptors, era as an empty string, energy 1, and tempo_feel "mid". Never guess attributes for a song you do not recognize.

Return every input song exactly once — same count, same ids.`

/**
 * Error result + server-side log (these failures were previously invisible in
 * the dev console). `safeToRetry: true` = the batch failed before the
 * billable model call, so retrying it is free.
 */
const fail = (
  step: string,
  message: string,
  safeToRetry = false,
): EnrichBatchResponse => {
  console.error(`[enrich] ${step} failed: ${message}`)
  return { status: 'error', message, safeToRetry }
}

/** Clamped integer env knob; malformed values fall back to the default. */
const readEnvInt = (
  name: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

type PendingSong = Pick<
  Tables<'songs'>,
  'id' | 'spotify_track_id' | 'title' | 'artists' | 'album' | 'release_date'
>

const describeSong = (song: PendingSong, index: number): string => {
  const title = song.title ?? 'unknown title'
  const artists =
    song.artists !== null && song.artists.length > 0
      ? song.artists.join(', ')
      : 'unknown artist'
  const album = song.album ?? 'unknown'
  const year =
    song.release_date !== null ? song.release_date.slice(0, 4) : 'unknown'
  return `${index + 1}. ${song.spotify_track_id} — "${title}" by ${artists} (album: ${album}, released: ${year})`
}

const buildUserPrompt = (
  songs: PendingSong[],
  genreNames: string[],
  moodNames: string[],
): string =>
  [
    `Approved genre vocabulary (choose only from these): ${
      genreNames.join(', ') || '(none)'
    }`,
    `Approved mood vocabulary (choose only from these): ${
      moodNames.join(', ') || '(none)'
    }`,
    '',
    'Songs:',
    ...songs.map(describeSong),
  ].join('\n')

/** Normalize, drop empties/overlong names, dedupe — order-preserving. */
const normalizeTagList = (names: string[]): string[] => {
  const seen = new Set<string>()
  for (const raw of names) {
    const name = normalizeTagName(raw)
    if (!isValidTagName(name)) continue
    seen.add(name)
  }
  return [...seen]
}

/** Round to the numeric(3,2) precision the column stores, clamped to 0-1. */
const roundConfidence = (value: number): number =>
  Math.min(1, Math.max(0, Math.round(value * 100) / 100))

/**
 * Records tags that matched no approved vocabulary row (unmatched_tags:
 * name + occurrence count) so gaps in the approved lists can be reviewed.
 * Best-effort — a logging failure must not fail a batch the model call
 * already paid for.
 */
const logUnmatchedTags = async (
  admin: ReturnType<typeof createAdminClient>,
  kind: 'genre' | 'mood',
  names: string[],
) => {
  if (names.length === 0) return
  const result = await admin.rpc('log_unmatched_tags', {
    p_kind: kind,
    p_names: names,
  })
  if (result.error !== null) {
    console.error(
      `[enrich] unmatched ${kind} log failed: ${result.error.message}`,
    )
  }
}

/**
 * Enrich one batch of the user's pending songs with one structured-output
 * call. Stateless per call — resumable by construction. Writes go through
 * the service-role client and touch only the enrichment columns
 * (`ai_confidence`, `ai_attributes`, `enrichment_status`,
 * `enrichment_model`, `enrichment_rank`, `enriched_at`) plus the AI tag link
 * tables.
 */
export const enrichLibraryBatch = async (
  userId: string,
  model: LlmModel,
  processedSoFar: number,
): Promise<EnrichBatchResponse> => {
  const batchSize = readEnvInt(
    'ENRICHMENT_BATCH_SIZE',
    DEFAULT_BATCH_SIZE,
    MIN_BATCH_SIZE,
    MAX_BATCH_SIZE,
  )
  const runCap = readEnvInt(
    'ENRICHMENT_MAX_SONGS_PER_RUN',
    DEFAULT_MAX_SONGS_PER_RUN,
    MIN_MAX_SONGS_PER_RUN,
    MAX_MAX_SONGS_PER_RUN,
  )

  let languageModel
  try {
    languageModel = resolveLanguageModel(model)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model unavailable'
    return fail('model resolution', message)
  }

  const admin = createAdminClient()

  const countByStatus = async (status: string) =>
    admin
      .from('user_songs')
      .select('song_id, songs!inner(enrichment_status)', {
        count: 'exact',
        head: true,
      })
      .eq('user_id', userId)
      .eq('songs.enrichment_status', status)

  const [pendingResult, enrichedResult, unknownResult] = await Promise.all([
    countByStatus('pending'),
    countByStatus('enriched'),
    countByStatus('unknown'),
  ])
  for (const result of [pendingResult, enrichedResult, unknownResult]) {
    if (result.error) return fail('status counts', result.error.message, true)
  }
  const pending = pendingResult.count ?? 0
  const enriched = enrichedResult.count ?? 0
  const unknown = unknownResult.count ?? 0
  const counts: EnrichmentCounts = {
    total: pending + enriched + unknown,
    enriched,
    unknown,
    pending,
  }

  if (pending === 0) return { status: 'done', ...counts }
  if (processedSoFar >= runCap) return { status: 'cap_reached', ...counts }

  const batchLimit = Math.min(batchSize, runCap - processedSoFar)
  const batchResult = await admin
    .from('user_songs')
    .select(
      'songs!inner(id, spotify_track_id, title, artists, album, release_date)',
    )
    .eq('user_id', userId)
    .eq('songs.enrichment_status', 'pending')
    .order('song_id', { ascending: true })
    .limit(batchLimit)
  if (batchResult.error) {
    return fail('batch select', batchResult.error.message, true)
  }
  const batchSongs: PendingSong[] = batchResult.data.map((row) => row.songs)

  // Another run may have drained the queue between the count and the select;
  // the next invocation recounts and returns done with fresh numbers.
  if (batchSongs.length === 0) {
    return {
      status: 'progress',
      batchProcessed: 0,
      batchEnriched: 0,
      batchUnknown: 0,
      ...counts,
    }
  }

  const [genreVocabResult, moodVocabResult] = await Promise.all([
    admin.from('genres').select('name').eq('is_approved', true).order('name'),
    admin.from('moods').select('name').eq('is_approved', true).order('name'),
  ])
  if (genreVocabResult.error) {
    return fail('genre vocabulary', genreVocabResult.error.message, true)
  }
  if (moodVocabResult.error) {
    return fail('mood vocabulary', moodVocabResult.error.message, true)
  }

  let batch
  try {
    const result = await generateText({
      model: languageModel,
      // Above the SDK default (2): flaky links (hotspots, sleeping dev
      // machines) surface transport errors in streaks, and this is the one
      // long-lived billable call in the batch.
      maxRetries: 4,
      output: Output.object({ schema: enrichmentBatchSchema }),
      instructions: SYSTEM_PROMPT,
      prompt: buildUserPrompt(
        batchSongs,
        genreVocabResult.data.map((row) => row.name),
        moodVocabResult.data.map((row) => row.name),
      ),
      providerOptions: { openai: { reasoningEffort: 'low' } },
    })
    batch = result.output
  } catch (error) {
    console.error('[enrich]', error)
    const message =
      error instanceof Error ? error.message : 'Enrichment call failed'
    return { status: 'error', message, safeToRetry: false }
  }

  // Match results back by the echoed id; drop ids we didn't ask about and
  // duplicates. Songs the model omitted stay pending.
  const songsById = new Map(
    batchSongs.map((song) => [song.spotify_track_id, song]),
  )
  const resultsByTrackId = new Map<string, EnrichedSong>()
  for (const entry of batch.songs) {
    if (!songsById.has(entry.spotify_track_id)) continue
    if (resultsByTrackId.has(entry.spotify_track_id)) continue
    resultsByTrackId.set(entry.spotify_track_id, entry)
  }

  interface EnrichedWrite {
    songId: string
    confidence: number
    entry: EnrichedSong
    genreNames: string[]
    moodNames: string[]
  }
  interface UnknownWrite {
    songId: string
    confidence: number
  }

  const enrichedWrites: EnrichedWrite[] = []
  const unknownWrites: UnknownWrite[] = []
  for (const [trackId, entry] of resultsByTrackId) {
    const song = songsById.get(trackId)
    if (song === undefined) continue
    const confidence = roundConfidence(entry.confidence)
    const genreNames = normalizeTagList(entry.genres)
    const moodNames = normalizeTagList(entry.moods)
    // Zero genres AND zero moods is the "unrecognized" placeholder shape —
    // the model sometimes emits it with confidence just above the threshold,
    // which would surface as an enriched song with no tags.
    const isPlaceholder = genreNames.length === 0 && moodNames.length === 0
    if (confidence < CONFIDENCE_THRESHOLD || isPlaceholder) {
      unknownWrites.push({ songId: song.id, confidence })
    } else {
      enrichedWrites.push({
        songId: song.id,
        confidence,
        entry,
        genreNames,
        moodNames,
      })
    }
  }

  const allGenreNames = normalizeTagList(
    enrichedWrites.flatMap((write) => write.genreNames),
  )
  const allMoodNames = normalizeTagList(
    enrichedWrites.flatMap((write) => write.moodNames),
  )
  const genreIdsResult = await matchApprovedVocabulary(
    admin,
    'genres',
    allGenreNames,
  )
  if (genreIdsResult.status === 'error') {
    return fail('genre match', genreIdsResult.message)
  }
  const moodIdsResult = await matchApprovedVocabulary(
    admin,
    'moods',
    allMoodNames,
  )
  if (moodIdsResult.status === 'error') {
    return fail('mood match', moodIdsResult.message)
  }

  // Off-list tags simply drop from their songs (the link loop below skips
  // names with no id); record them so gaps in the approved lists surface.
  await Promise.all([
    logUnmatchedTags(admin, 'genre', genreIdsResult.unmatched),
    logUnmatchedTags(admin, 'mood', moodIdsResult.unmatched),
  ])

  // Links land before the status flip so a mid-batch crash leaves the song
  // pending and the retry's idempotent inserts absorb the repeat.
  const songGenreRows: TablesInsert<'song_genres'>[] = []
  const songMoodRows: TablesInsert<'song_moods'>[] = []
  for (const write of enrichedWrites) {
    for (const name of write.genreNames) {
      const genreId = genreIdsResult.idsByName.get(name)
      if (genreId !== undefined) {
        songGenreRows.push({ song_id: write.songId, genre_id: genreId })
      }
    }
    for (const name of write.moodNames) {
      const moodId = moodIdsResult.idsByName.get(name)
      if (moodId !== undefined) {
        songMoodRows.push({ song_id: write.songId, mood_id: moodId })
      }
    }
  }
  if (songGenreRows.length > 0) {
    const result = await admin.from('song_genres').upsert(songGenreRows, {
      onConflict: 'song_id,genre_id',
      ignoreDuplicates: true,
    })
    if (result.error) return fail('genre links', result.error.message)
  }
  if (songMoodRows.length > 0) {
    const result = await admin.from('song_moods').upsert(songMoodRows, {
      onConflict: 'song_id,mood_id',
      ignoreDuplicates: true,
    })
    if (result.error) return fail('mood links', result.error.message)
  }

  // An unknown song must carry no AI tags, but a batch that died after its
  // link writes leaves the earlier attempt's rows behind. Clear them before
  // the flip: a crash in between leaves the song in its previous state with
  // no links, which the next run re-enriches cleanly.
  const unknownSongIds = unknownWrites.map((write) => write.songId)
  if (unknownSongIds.length > 0) {
    const [staleGenres, staleMoods] = await Promise.all([
      admin.from('song_genres').delete().in('song_id', unknownSongIds),
      admin.from('song_moods').delete().in('song_id', unknownSongIds),
    ])
    if (staleGenres.error) {
      return fail('unknown links', staleGenres.error.message)
    }
    if (staleMoods.error) return fail('unknown links', staleMoods.error.message)
  }

  const modelString = toEnrichmentModelString(model)
  const enrichedAt = new Date().toISOString()

  // Every update targets a distinct row with no ordering dependency, so the
  // status flips go out concurrently instead of one round trip per song.
  const enrichedUpdates = enrichedWrites.map((write) => {
    const attributes: SongAIAttributes = {
      energy: write.entry.energy,
      tempo_feel: write.entry.tempo_feel,
      era: write.entry.era,
      instrumentation: write.entry.instrumentation,
      descriptors: write.entry.descriptors,
    }
    return admin
      .from('songs')
      .update({
        ai_confidence: write.confidence,
        ai_attributes: attributes,
        enrichment_status: 'enriched',
        enrichment_model: modelString,
        enrichment_rank: model.enrichment_rank,
        enriched_at: enrichedAt,
      })
      .eq('id', write.songId)
  })
  const unknownUpdates = unknownWrites.map((write) =>
    admin
      .from('songs')
      .update({
        ai_confidence: write.confidence,
        ai_attributes: null,
        enrichment_status: 'unknown',
        enrichment_model: modelString,
        enrichment_rank: model.enrichment_rank,
        enriched_at: enrichedAt,
      })
      .eq('id', write.songId),
  )
  const [enrichedResults, unknownResults] = await Promise.all([
    Promise.all(enrichedUpdates),
    Promise.all(unknownUpdates),
  ])
  for (const result of enrichedResults) {
    if (result.error) return fail('enriched write', result.error.message)
  }
  for (const result of unknownResults) {
    if (result.error) return fail('unknown write', result.error.message)
  }

  const batchEnriched = enrichedWrites.length
  const batchUnknown = unknownWrites.length
  return {
    status: 'progress',
    batchProcessed: batchSongs.length,
    batchEnriched,
    batchUnknown,
    total: counts.total,
    enriched: counts.enriched + batchEnriched,
    unknown: counts.unknown + batchUnknown,
    pending: counts.pending - batchEnriched - batchUnknown,
  }
}
