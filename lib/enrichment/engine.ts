import { generateText, Output } from 'ai'

import { type LlmModel, toEnrichmentModelString } from '@/lib/ai/models'
import { resolveLanguageModel } from '@/lib/ai/providers'
import { IMPROVABLE_SONGS_FILTER } from '@/lib/enrichment/accuracy'
import { MAX_ENRICHMENT_ATTEMPTS, NO_RANK } from '@/lib/enrichment/rank'
import {
  CONFIDENCE_THRESHOLD,
  type EnrichedSong,
  enrichmentBatchSchema,
  type SongAIAttributes,
} from '@/lib/enrichment/schema'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/supabase/types'
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

/**
 * Library-wide counts for the requesting user. `total` is every song, and the
 * other four are all relative to the *selected model*, so they change with the
 * chosen model and need not add up to `total`: `pending` counts only the
 * never-analyzed rows this model may still send (songs it gave up on after
 * repeated omissions drop out), and `improvable` overlaps `enriched`/`unknown`
 * with the None and Low rows it is allowed to redo.
 */
export interface EnrichmentCounts {
  total: number
  enriched: number
  unknown: number
  pending: number
  improvable: number
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
      /** Selected but left out of the model's response — see recordOmissions. */
      batchOmitted: number
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

type BatchSong = Pick<
  Tables<'songs'>,
  | 'id'
  | 'spotify_track_id'
  | 'title'
  | 'artists'
  | 'album'
  | 'release_date'
  | 'enrichment_status'
  | 'enrichment_rank'
  | 'enrichment_attempts'
>

const BATCH_SONG_COLUMNS =
  'songs!inner(id, spotify_track_id, title, artists, album, release_date, enrichment_status, enrichment_rank, enrichment_attempts)'

const describeSong = (song: BatchSong, index: number): string => {
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
  songs: BatchSong[],
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
 * The only columns enrichment may write on `songs` — the mirror image of
 * `SongMetadata` in `lib/spotify/import.ts`, which pins the import side to the
 * Spotify metadata columns. Between the two, the disjointness that keeps a
 * re-sync from clobbering paid enrichment (and a batch from corrupting
 * metadata) is a compile error in both directions rather than a convention.
 *
 * Every enrichment write below is typed through this alias; widening it is the
 * deliberate act of changing what enrichment owns.
 */
type EnrichmentWrite = Pick<
  TablesUpdate<'songs'>,
  | 'ai_attributes'
  | 'ai_confidence'
  | 'enriched_at'
  | 'enrichment_attempts'
  | 'enrichment_model'
  | 'enrichment_rank'
  | 'enrichment_skipped_rank'
  | 'enrichment_status'
>

/**
 * Counts one omission against each song the model left out of its response.
 * At `MAX_ENRICHMENT_ATTEMPTS` the song is set aside at this model's rank and
 * the counter resets, so the selector stops sending it until a strictly
 * stronger model is chosen.
 *
 * Best-effort, like the unmatched-tag log: the batch has already been billed
 * and written by the time this runs, so a bookkeeping failure must not turn a
 * successful batch into an error the client retries and pays for again. A lost
 * increment only delays giving up.
 */
const recordOmissions = async (
  admin: ReturnType<typeof createAdminClient>,
  songs: BatchSong[],
  modelRank: number,
) => {
  if (songs.length === 0) return
  const results = await Promise.all(
    songs.map((song) => {
      const attempts = song.enrichment_attempts + 1
      const update: EnrichmentWrite =
        attempts >= MAX_ENRICHMENT_ATTEMPTS
          ? { enrichment_attempts: 0, enrichment_skipped_rank: modelRank }
          : { enrichment_attempts: attempts }
      return admin.from('songs').update(update).eq('id', song.id)
    }),
  )
  for (const result of results) {
    if (result.error !== null) {
      console.error(`[enrich] omission write failed: ${result.error.message}`)
    }
  }
}

/**
 * Enrich one batch of the user's pending songs with one structured-output
 * call. Stateless per call — resumable by construction. Writes go through the
 * service-role client and touch only the enrichment columns — the eight in
 * `EnrichmentWrite`, which every write below is typed against — plus the AI
 * tag link tables.
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

  // total counts every song in the library, so it stays whole even though the
  // three buckets below are each filtered by what this model may still touch.
  const countTotal = async () =>
    admin
      .from('user_songs')
      .select('song_id', { count: 'exact', head: true })
      .eq('user_id', userId)

  // Not async: the pending variant below chains one more filter onto it.
  const countByStatus = (status: string) =>
    admin
      .from('user_songs')
      .select('song_id, songs!inner(enrichment_status)', {
        count: 'exact',
        head: true,
      })
      .eq('user_id', userId)
      .eq('songs.enrichment_status', status)

  // Pending rows this model may still send. Rows it already gave up on after
  // repeated omissions are excluded, so the run reaches done instead of
  // spinning on a batch the selector can no longer fill.
  const countPending = () =>
    countByStatus('pending').lt(
      'songs.enrichment_skipped_rank',
      model.enrichment_rank,
    )

  // None/Low rows this model is allowed to redo: eligible by band, ranked
  // strictly below it, and not given up on. Because songs.enrichment_rank is
  // not null default 0, "never enriched" sorts below every real rank with no
  // null branch.
  const countImprovable = async () =>
    admin
      .from('user_songs')
      .select('song_id, songs!inner(enrichment_status, ai_confidence)', {
        count: 'exact',
        head: true,
      })
      .eq('user_id', userId)
      .or(IMPROVABLE_SONGS_FILTER, { referencedTable: 'songs' })
      .lt('songs.enrichment_rank', model.enrichment_rank)
      .lt('songs.enrichment_skipped_rank', model.enrichment_rank)

  const [
    totalResult,
    pendingResult,
    enrichedResult,
    unknownResult,
    improvableResult,
  ] = await Promise.all([
    countTotal(),
    countPending(),
    countByStatus('enriched'),
    countByStatus('unknown'),
    countImprovable(),
  ])
  for (const result of [
    totalResult,
    pendingResult,
    enrichedResult,
    unknownResult,
    improvableResult,
  ]) {
    if (result.error) return fail('status counts', result.error.message, true)
  }
  const pending = pendingResult.count ?? 0
  const enriched = enrichedResult.count ?? 0
  const unknown = unknownResult.count ?? 0
  const improvable = improvableResult.count ?? 0
  const counts: EnrichmentCounts = {
    total: totalResult.count ?? 0,
    enriched,
    unknown,
    pending,
    improvable,
  }

  // Nothing left for this model: neither a first pass nor an upgrade.
  if (pending === 0 && improvable === 0) return { status: 'done', ...counts }
  if (processedSoFar >= runCap) return { status: 'cap_reached', ...counts }

  const batchLimit = Math.min(batchSize, runCap - processedSoFar)

  // Newest-liked first, so a partially-enriched library fills in from the top
  // of what /library shows. song_id breaks ties, keeping the order fully
  // deterministic — that is what lets the zero-progress guard re-pick the same
  // songs on each strike.
  const selectSongs = (limit: number) =>
    admin
      .from('user_songs')
      .select(BATCH_SONG_COLUMNS)
      .eq('user_id', userId)
      .order('liked_at', { ascending: false })
      .order('song_id', { ascending: true })
      .limit(limit)

  const pendingBatch = await selectSongs(batchLimit)
    .eq('songs.enrichment_status', 'pending')
    .lt('songs.enrichment_skipped_rank', model.enrichment_rank)
  if (pendingBatch.error) {
    return fail('batch select', pendingBatch.error.message, true)
  }
  const batchSongs: BatchSong[] = pendingBatch.data.map((row) => row.songs)

  // Pending first, improvable at the tail: a first pass over songs that have
  // never been analyzed always outranks re-asking about one that has.
  const improvableSongIds = new Set<string>()
  if (batchSongs.length < batchLimit) {
    const improvableBatch = await selectSongs(batchLimit - batchSongs.length)
      .or(IMPROVABLE_SONGS_FILTER, { referencedTable: 'songs' })
      .lt('songs.enrichment_rank', model.enrichment_rank)
      .lt('songs.enrichment_skipped_rank', model.enrichment_rank)
    if (improvableBatch.error) {
      return fail('improvable select', improvableBatch.error.message, true)
    }
    for (const row of improvableBatch.data) {
      improvableSongIds.add(row.songs.id)
      batchSongs.push(row.songs)
    }
  }

  // Another run may have drained the queue between the count and the select.
  // Report that as done, not as a zero-work progress step: the counts above
  // are already stale, and a zero-write progress response is what the client's
  // stall guard counts as a strike.
  if (batchSongs.length === 0) return { status: 'done', ...counts }

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
  // duplicates. Songs the model omitted keep their current status and get no
  // write — they are counted against MAX_ENRICHMENT_ATTEMPTS further down.
  const songsById = new Map(
    batchSongs.map((song) => [song.spotify_track_id, song]),
  )
  const resultsByTrackId = new Map<string, EnrichedSong>()
  for (const entry of batch.songs) {
    if (!songsById.has(entry.spotify_track_id)) continue
    if (resultsByTrackId.has(entry.spotify_track_id)) continue
    resultsByTrackId.set(entry.spotify_track_id, entry)
  }

  // priorStatus: with improvable rows in the batch, a write no longer
  // necessarily came from `pending` — the count deltas at the end are computed
  // from where each song actually started.
  interface EnrichedWrite {
    songId: string
    priorStatus: string
    confidence: number
    entry: EnrichedSong
    genreNames: string[]
    moodNames: string[]
  }
  interface UnknownWrite {
    songId: string
    priorStatus: string
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
      unknownWrites.push({
        songId: song.id,
        priorStatus: song.enrichment_status,
        confidence,
      })
    } else {
      enrichedWrites.push({
        songId: song.id,
        priorStatus: song.enrichment_status,
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
    const update: EnrichmentWrite = {
      ai_confidence: write.confidence,
      ai_attributes: attributes,
      enrichment_status: 'enriched',
      enrichment_model: modelString,
      enrichment_rank: model.enrichment_rank,
      enrichment_attempts: 0,
      enrichment_skipped_rank: NO_RANK,
      enriched_at: enrichedAt,
    }
    return admin.from('songs').update(update).eq('id', write.songId)
  })
  const unknownUpdates = unknownWrites.map((write) => {
    const update: EnrichmentWrite = {
      ai_confidence: write.confidence,
      ai_attributes: null,
      enrichment_status: 'unknown',
      enrichment_model: modelString,
      enrichment_rank: model.enrichment_rank,
      enrichment_attempts: 0,
      enrichment_skipped_rank: NO_RANK,
      enriched_at: enrichedAt,
    }
    return admin.from('songs').update(update).eq('id', write.songId)
  })
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

  // Only now that every write has landed: an earlier failure returns before
  // this point, so a batch that half-committed under-counts its omissions
  // rather than giving up on songs it never really got an answer about.
  const omittedSongs = batchSongs.filter(
    (song) => !resultsByTrackId.has(song.spotify_track_id),
  )
  await recordOmissions(admin, omittedSongs, model.enrichment_rank)

  const batchEnriched = enrichedWrites.length
  const batchUnknown = unknownWrites.length

  // Project the new counts from where each written song started. A re-enriched
  // Low row that stays Low moves nothing between the status buckets; only a
  // genuine transition does.
  const statusDelta = { pending: 0, enriched: 0, unknown: 0 }
  const recordTransition = (from: string, to: 'enriched' | 'unknown') => {
    if (from === to) return
    if (from === 'pending') statusDelta.pending -= 1
    else if (from === 'enriched') statusDelta.enriched -= 1
    else if (from === 'unknown') statusDelta.unknown -= 1
    statusDelta[to] += 1
  }
  for (const write of enrichedWrites) {
    recordTransition(write.priorStatus, 'enriched')
  }
  for (const write of unknownWrites) {
    recordTransition(write.priorStatus, 'unknown')
  }

  // Every write raises the row to this model's rank, so an improvable song
  // that was written is no longer improvable *by this model*. Omitted songs
  // stay eligible until their attempts run out, which the next batch's recount
  // picks up.
  const improvableWritten = [...enrichedWrites, ...unknownWrites].filter(
    (write) => improvableSongIds.has(write.songId),
  ).length

  return {
    status: 'progress',
    batchProcessed: batchSongs.length,
    batchEnriched,
    batchUnknown,
    batchOmitted: omittedSongs.length,
    total: counts.total,
    enriched: counts.enriched + statusDelta.enriched,
    unknown: counts.unknown + statusDelta.unknown,
    pending: counts.pending + statusDelta.pending,
    improvable: counts.improvable - improvableWritten,
  }
}
