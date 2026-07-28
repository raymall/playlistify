// Server-only chat tools. createChatTools closes over the request's RLS client
// (user-scoped by construction) and memoizes the enriched-library index for the
// request. Two tools: search_library (SQL narrows, LLM curates) and
// propose_playlist (verifies + shapes the preview payload). All optional inputs
// are modeled required-with-null/empty to stay inside OpenAI strict tool
// schemas.

import type { SupabaseClient } from '@supabase/supabase-js'
import { tool } from 'ai'
import { z } from 'zod'

import type { ProposalTrack, SearchResultContract } from '@/lib/chat/contract'
import {
  type CandidateRow,
  fetchCandidateRows,
  fetchLinkedSongIds,
  getSelectableLibraryIndex,
  type LibraryTag,
  type LibraryTagSummary,
  type SelectableIndexEntry,
} from '@/lib/chat/library-search'
import type { Database } from '@/lib/supabase/types'
import { normalizeTagName, snapToExistingName } from '@/lib/vocabulary'

type Client = SupabaseClient<Database>

/**
 * Ceiling on matches fetched + carried per search. There is no product cap on
 * playlist size — by default the whole match set becomes the playlist — but a
 * technical bound protects against a single filter dragging in an entire large
 * library (and the token cost of round-tripping the proposal). Sits well above
 * any realistic single-intent match; searches that exceed it are truncated with
 * a hint rather than silently.
 */
const SCAN_CAP = 1000
/** Sample of matches shown to the model — it decides by count, not by reading
 *  every row; the full set is included via propose's includeAllMatches. */
const MODEL_SAMPLE_CAP = 80
const OWNERSHIP_CHUNK = 100

const NAME_MAX = 100
const DESCRIPTION_MAX = 300
const REASON_MAX = 160
/** Max tracks the model may enumerate explicitly (the include-all path does not
 *  enumerate, so a bigger playlist doesn't need a bigger list here). */
const EXPLICIT_TRACKS_MAX = 1000

const searchLibraryInputSchema = z.object({
  genres: z.array(z.string()).max(8),
  moods: z.array(z.string()).max(8),
  eras: z.array(z.string()).max(4),
  excludeTerms: z.array(z.string()).max(8),
  energyMin: z.number().int().min(1).max(5).nullable(),
  energyMax: z.number().int().min(1).max(5).nullable(),
})

const proposePlaylistInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  // Default true: build the playlist from EVERY match of the last search (no
  // size cap). Set false only when the user asked for a specific number or a
  // hand-picked selection, and then enumerate that subset in `tracks`.
  includeAllMatches: z.boolean(),
  tracks: z
    .array(
      z.object({
        songId: z.string(),
        reason: z.string(),
      }),
    )
    .max(EXPLICIT_TRACKS_MAX),
})

type SearchLibraryInput = z.infer<typeof searchLibraryInputSchema>

const normalizeNames = (raw: string[]): string[] => {
  const seen = new Set<string>()
  for (const value of raw) {
    const name = normalizeTagName(value)
    if (name.length > 0) seen.add(name)
  }
  return [...seen]
}

/**
 * Resolve requested tag names against the vocabulary the model was shown, with
 * the same snapping order as the enrichment path (exact → space-insensitive →
 * trigram) via `snapToExistingName`. Deliberately NOT `matchApprovedVocabulary`:
 * the library's vocabulary includes the user's own tags, which may be
 * unapproved, and every name the prompt lists has to be searchable. An
 * unapproved id simply finds nothing in song_genres/song_moods, which is right.
 */
const resolveTags = (
  names: string[],
  vocabulary: LibraryTag[],
): { ids: string[]; unmatched: string[] } => {
  const idByName = new Map(vocabulary.map((tag) => [tag.name, tag.id]))
  const existingNames = vocabulary.map((tag) => tag.name)
  const ids = new Set<string>()
  const unmatched: string[] = []
  for (const name of names) {
    const canonical = snapToExistingName(name, existingNames)
    const id = canonical === null ? undefined : idByName.get(canonical)
    if (id === undefined) unmatched.push(name)
    else ids.add(id)
  }
  return { ids: [...ids], unmatched }
}

const union = (a: Set<string>, b: Set<string>): Set<string> => {
  const out = new Set(a)
  for (const value of b) out.add(value)
  return out
}

const intersect = (a: Set<string>, b: Set<string>): Set<string> => {
  const out = new Set<string>()
  for (const value of a) if (b.has(value)) out.add(value)
  return out
}

const buildHaystack = (row: CandidateRow): string =>
  [
    row.title ?? '',
    ...row.artists,
    ...row.genres,
    ...row.moods,
    row.attributes?.era ?? '',
    ...(row.attributes?.descriptors ?? []),
    ...(row.attributes?.instrumentation ?? []),
  ]
    .join(' ')
    .toLowerCase()

const passesAttributeFilters = (
  row: CandidateRow,
  input: SearchLibraryInput,
): boolean => {
  if (input.energyMin !== null || input.energyMax !== null) {
    const energy = row.attributes?.energy
    if (typeof energy !== 'number') return false
    let lo = input.energyMin ?? 1
    let hi = input.energyMax ?? 5
    if (lo > hi) [lo, hi] = [hi, lo]
    if (energy < lo || energy > hi) return false
  }

  if (input.eras.length > 0) {
    const era = normalizeTagName(row.attributes?.era ?? '')
    if (era.length === 0) return false
    // Normalized equality or suffix match, so "90s" matches "1990s".
    const hasEraMatch = input.eras.some((rawEra) => {
      const req = normalizeTagName(rawEra)
      return (
        req.length > 0 &&
        (era === req || era.endsWith(req) || req.endsWith(era))
      )
    })
    if (!hasEraMatch) return false
  }

  if (input.excludeTerms.length > 0) {
    const haystack = buildHaystack(row)
    const terms = input.excludeTerms
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term.length > 0)
    if (terms.some((term) => haystack.includes(term))) return false
  }

  return true
}

const toCandidate = (row: CandidateRow) => ({
  songId: row.songId,
  title: row.title ?? 'Untitled',
  artists: row.artists,
  era: row.attributes?.era ?? null,
  energy: row.attributes?.energy ?? null,
  tempoFeel: row.attributes?.tempo_feel ?? null,
  genres: row.genres,
  moods: row.moods,
  durationMs: row.durationMs,
})

const searchLibrary = async (
  supabase: Client,
  getIndex: () => Promise<SelectableIndexEntry[]>,
  vocabulary: LibraryTagSummary,
  input: SearchLibraryInput,
) => {
  const index = await getIndex()
  if (index.length === 0) {
    return {
      result: {
        matchCount: 0,
        totalTagMatches: 0,
        scanned: 0,
        sampled: 0,
        truncated: false,
        unmatchedTags: [],
        candidates: [],
        hint: 'No songs are selectable yet — analyze songs on the Library page, or tag some yourself.',
      } satisfies SearchResultContract,
      matchIds: [],
    }
  }

  const genreNames = normalizeNames(input.genres)
  const moodNames = normalizeNames(input.moods)

  const genreMatch = resolveTags(genreNames, vocabulary.genres)
  const moodMatch = resolveTags(moodNames, vocabulary.moods)
  const unmatchedTags = [...genreMatch.unmatched, ...moodMatch.unmatched]

  const genreIds = genreMatch.ids
  const moodIds = moodMatch.ids

  // AI-linked OR user-linked within a kind; AND across kinds. null = no tag
  // filter (the whole enriched index qualifies).
  let matchedIds: Set<string> | null = null
  if (genreNames.length > 0) {
    const [ai, user] = await Promise.all([
      fetchLinkedSongIds(supabase, 'song_genres', genreIds),
      fetchLinkedSongIds(supabase, 'user_genres', genreIds),
    ])
    matchedIds = union(ai, user)
  }
  if (moodNames.length > 0) {
    const [ai, user] = await Promise.all([
      fetchLinkedSongIds(supabase, 'song_moods', moodIds),
      fetchLinkedSongIds(supabase, 'user_moods', moodIds),
    ])
    const moodSet = union(ai, user)
    matchedIds = matchedIds === null ? moodSet : intersect(matchedIds, moodSet)
  }

  const filterIds = matchedIds
  const orderedIds =
    filterIds === null
      ? index.map((entry) => entry.songId)
      : index
          .filter((entry) => filterIds.has(entry.songId))
          .map((entry) => entry.songId)

  const totalTagMatches = orderedIds.length
  const scanIds = orderedIds.slice(0, SCAN_CAP)

  // fetchCandidateRows returns rows in arbitrary order — reorder to recency.
  const rowsById = new Map(
    (await fetchCandidateRows(supabase, scanIds)).map((row) => [
      row.songId,
      row,
    ]),
  )
  const orderedRows = scanIds
    .map((songId) => rowsById.get(songId))
    .filter((row): row is CandidateRow => row !== undefined)

  const filtered = orderedRows.filter((row) =>
    passesAttributeFilters(row, input),
  )
  // The full match set — this, not the sample below, is what an
  // includeAllMatches proposal turns into a playlist.
  const matchIds = filtered.map((row) => row.songId)
  const sample = filtered.slice(0, MODEL_SAMPLE_CAP).map(toCandidate)

  const isTruncated = totalTagMatches > scanIds.length

  let hint: string | undefined
  if (matchIds.length === 0) {
    hint =
      unmatchedTags.length > 0
        ? `No songs matched. These tags are not in the library's vocabulary: ${unmatchedTags.join(', ')}. Re-search using only names from the genre and mood lists in your instructions.`
        : 'No songs matched these filters. Relax the energy range, eras, or tags and search again.'
  } else if (sample.length < matchIds.length) {
    hint = `Showing ${sample.length} of ${matchIds.length} matches as a sample. Propose with includeAllMatches: true to use all ${matchIds.length}.`
  }

  return {
    result: {
      matchCount: matchIds.length,
      totalTagMatches,
      scanned: scanIds.length,
      sampled: sample.length,
      truncated: isTruncated,
      unmatchedTags,
      candidates: sample,
      hint,
    } satisfies SearchResultContract,
    matchIds,
  }
}

const clampName = (raw: string): string => {
  const trimmed = raw.trim()
  const value = trimmed.length > 0 ? trimmed : 'Playlist'
  return value.slice(0, NAME_MAX)
}

const proposePlaylist = async (
  supabase: Client,
  input: z.infer<typeof proposePlaylistInputSchema>,
  lastMatchIds: string[],
) => {
  // Dedupe by songId, preserving first-seen (proposal) order.
  const reasonBySongId = new Map<string, string>()
  const enumeratedIds: string[] = []
  for (const track of input.tracks) {
    if (reasonBySongId.has(track.songId)) continue
    reasonBySongId.set(track.songId, track.reason.trim().slice(0, REASON_MAX))
    enumeratedIds.push(track.songId)
  }

  // Default path: the playlist IS the full match set of the last search, so a
  // "all my salsa" request yields every match rather than a sampled subset.
  // The model only enumerates tracks when it deliberately curates a subset.
  const shouldIncludeAll = input.includeAllMatches && lastMatchIds.length > 0
  const orderedIds = shouldIncludeAll ? lastMatchIds : enumeratedIds

  if (orderedIds.length === 0) {
    return {
      status: 'error' as const,
      message:
        'No songs to propose. Run search_library first, then propose with includeAllMatches: true, or list specific songIds in tracks.',
    }
  }

  // Ownership check. The includeAllMatches ids came straight from the user's
  // own RLS-scoped enriched index, so they are owned by construction — skip the
  // extra round-trips there and only verify model-enumerated ids.
  let rejectedSongIds: string[] = []
  let validIds = orderedIds
  if (!shouldIncludeAll) {
    const owned = new Set<string>()
    for (let i = 0; i < orderedIds.length; i += OWNERSHIP_CHUNK) {
      const chunk = orderedIds.slice(i, i + OWNERSHIP_CHUNK)
      const { data, error } = await supabase
        .from('user_songs')
        .select('song_id')
        .in('song_id', chunk)
      if (error) throw new Error(error.message)
      for (const row of data) owned.add(row.song_id)
    }
    rejectedSongIds = orderedIds.filter((id) => !owned.has(id))
    validIds = orderedIds.filter((id) => owned.has(id))
  }

  if (validIds.length === 0) {
    return {
      status: 'error' as const,
      message:
        'None of these songs are in your library. Use only songIds returned by search_library.',
    }
  }

  const rowsById = new Map(
    (await fetchCandidateRows(supabase, validIds)).map((row) => [
      row.songId,
      row,
    ]),
  )

  const tracks: ProposalTrack[] = []
  for (const songId of validIds) {
    const row = rowsById.get(songId)
    if (row === undefined) continue
    tracks.push({
      songId,
      title: row.title ?? 'Untitled',
      artists: row.artists,
      albumArtUrl: row.albumArtUrl,
      durationMs: row.durationMs,
      reason: reasonBySongId.get(songId) ?? '',
    })
  }

  return {
    status: 'ok' as const,
    name: clampName(input.name),
    description: input.description.trim().slice(0, DESCRIPTION_MAX),
    tracks,
    rejectedSongIds,
  }
}

/**
 * Build the chat tool set bound to the request's RLS client. The selectable-
 * library index is fetched once and shared across every search_library call in
 * the request. `vocabulary` is the same summary the system prompt was built
 * from, so the assistant can search exactly the names it was shown.
 */
export const createChatTools = (
  supabase: Client,
  vocabulary: LibraryTagSummary,
) => {
  let indexPromise: Promise<SelectableIndexEntry[]> | null = null
  const getIndex = () => {
    indexPromise ??= getSelectableLibraryIndex(supabase)
    return indexPromise
  }

  // Full match set of the most recent search, so propose_playlist can build a
  // playlist from every match without the model enumerating them all.
  let lastMatchIds: string[] = []

  return {
    search_library: tool({
      description:
        'Search the user\'s own enriched library. Filters are ANDed across kinds and ORed within a kind; energy is 1 (calm) to 5 (intense); eras use a decade format like "1990s". Returns `matchCount` (the full number of matches) plus a `candidates` SAMPLE of them — the sample is for judging fit, not the playlist size. Call with empty arrays and null energies to get the most recent enriched songs.',
      inputSchema: searchLibraryInputSchema,
      execute: async (input) => {
        const { result, matchIds } = await searchLibrary(
          supabase,
          getIndex,
          vocabulary,
          input,
        )
        lastMatchIds = matchIds
        return result
      },
    }),
    propose_playlist: tool({
      description:
        'Propose the final playlist to show the user in the preview panel. Provide a name and a short description. Set includeAllMatches: true (the DEFAULT) to use EVERY match from the last search — leave `tracks` empty in that case; there is no playlist size limit. Only set includeAllMatches: false when the user asked for a specific count or a hand-picked subset, and then list exactly those songIds in `tracks`. This renders the proposal UI — never also list the tracks in chat.',
      inputSchema: proposePlaylistInputSchema,
      execute: (input) => proposePlaylist(supabase, input, lastMatchIds),
    }),
  }
}
