// Server-only query layer for chat library selection. Supabase REST caps
// responses at 1000 rows, so scans that can exceed that page with `.range()`.
// Every query runs on the request's RLS client, so results are user-scoped by
// construction; AI link tables (song_genres/song_moods) are shared, but the
// enriched-index intersection re-scopes them to the requester's own songs.

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  readSongAIAttributes,
  type SongAIAttributes,
} from '@/lib/enrichment/schema'
import type { Database } from '@/lib/supabase/types'

type Client = SupabaseClient<Database>

const PAGE_SIZE = 1000

/** Distinct genre/mood names present in the library, plus head counts. */
export interface LibraryTagSummary {
  genres: string[]
  moods: string[]
  totalSongs: number
  enrichedSongs: number
}

export interface EnrichedIndexEntry {
  songId: string
  likedAt: string | null
}

export interface CandidateRow {
  songId: string
  title: string | null
  artists: string[]
  albumArtUrl: string | null
  durationMs: number | null
  attributes: SongAIAttributes | null
  genres: string[]
  moods: string[]
}

/** Cap on distinct tag names surfaced to the prompt per kind. */
const TAG_SUMMARY_CAP = 150
/** Rows scanned when sampling library tag names (bounded, recent-first). */
const TAG_SUMMARY_MAX_ROWS = 2000

const dedupe = (names: Iterable<string>): string[] => [...new Set(names)]

/**
 * Head counts + a representative distinct set of the tag names actually
 * present in the user's enriched library (grounds the system prompt's example
 * filter values). The name scan is bounded to the most recent rows — the model
 * relies on search_library's fuzzy snapping for exact matching, so a
 * representative sample is enough here.
 */
export const getLibraryTagSummary = async (
  supabase: Client,
): Promise<LibraryTagSummary> => {
  const [totalResult, enrichedResult] = await Promise.all([
    supabase
      .from('user_songs')
      .select('song_id', { count: 'exact', head: true }),
    supabase
      .from('user_songs')
      .select('song_id, songs!inner(enrichment_status)', {
        count: 'exact',
        head: true,
      })
      .eq('songs.enrichment_status', 'enriched'),
  ])

  const totalSongs = totalResult.count ?? 0
  const enrichedSongs = enrichedResult.count ?? 0

  const genres = new Set<string>()
  const moods = new Set<string>()

  for (let from = 0; from < TAG_SUMMARY_MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('user_songs')
      .select(
        'songs!inner(enrichment_status, song_genres(genres(name)), song_moods(moods(name)))',
      )
      .eq('songs.enrichment_status', 'enriched')
      .order('liked_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    for (const row of data) {
      for (const link of row.songs.song_genres) {
        if (genres.size < TAG_SUMMARY_CAP) genres.add(link.genres.name)
      }
      for (const link of row.songs.song_moods) {
        if (moods.size < TAG_SUMMARY_CAP) moods.add(link.moods.name)
      }
    }
    if (data.length < PAGE_SIZE) break
  }

  // The user's own manual tags are RLS-scoped and small — fold them in too.
  const [userGenres, userMoods] = await Promise.all([
    supabase.from('user_genres').select('genres(name)'),
    supabase.from('user_moods').select('moods(name)'),
  ])
  if (!userGenres.error) {
    for (const row of userGenres.data) {
      if (genres.size < TAG_SUMMARY_CAP) genres.add(row.genres.name)
    }
  }
  if (!userMoods.error) {
    for (const row of userMoods.data) {
      if (moods.size < TAG_SUMMARY_CAP) moods.add(row.moods.name)
    }
  }

  return {
    genres: [...genres].sort(),
    moods: [...moods].sort(),
    totalSongs,
    enrichedSongs,
  }
}

/**
 * All enriched songs in the user's library, most-recently-liked first. This is
 * the candidate universe every search intersects against; a stable secondary
 * order on song_id keeps `.range()` pagination from skipping/duplicating rows.
 */
export const getEnrichedLibraryIndex = async (
  supabase: Client,
): Promise<EnrichedIndexEntry[]> => {
  const entries: EnrichedIndexEntry[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('user_songs')
      .select('song_id, liked_at, songs!inner(enrichment_status)')
      .eq('songs.enrichment_status', 'enriched')
      .order('liked_at', { ascending: false, nullsFirst: false })
      .order('song_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    for (const row of data) {
      entries.push({ songId: row.song_id, likedAt: row.liked_at })
    }
    if (data.length < PAGE_SIZE) break
  }
  return entries
}

export type LinkTable =
  'song_genres' | 'song_moods' | 'user_genres' | 'user_moods'

const pageLinkTable = (
  supabase: Client,
  table: LinkTable,
  vocabIds: string[],
  from: number,
  to: number,
) => {
  // Concrete per-table calls so the union type resolves cleanly (each link
  // table names its vocabulary column genre_id or mood_id).
  switch (table) {
    case 'song_genres':
      return supabase
        .from('song_genres')
        .select('song_id')
        .in('genre_id', vocabIds)
        .range(from, to)
    case 'song_moods':
      return supabase
        .from('song_moods')
        .select('song_id')
        .in('mood_id', vocabIds)
        .range(from, to)
    case 'user_genres':
      return supabase
        .from('user_genres')
        .select('song_id')
        .in('genre_id', vocabIds)
        .range(from, to)
    case 'user_moods':
      return supabase
        .from('user_moods')
        .select('song_id')
        .in('mood_id', vocabIds)
        .range(from, to)
  }
}

/** Song ids linked to any of `vocabIds` in the given link table (paged). */
export const fetchLinkedSongIds = async (
  supabase: Client,
  table: LinkTable,
  vocabIds: string[],
): Promise<Set<string>> => {
  const ids = new Set<string>()
  if (vocabIds.length === 0) return ids
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await pageLinkTable(
      supabase,
      table,
      vocabIds,
      from,
      from + PAGE_SIZE - 1,
    )
    if (error) throw new Error(error.message)
    for (const row of data) ids.add(row.song_id)
    if (data.length < PAGE_SIZE) break
  }
  return ids
}

const CANDIDATE_FETCH_CHUNK = 100

/**
 * Fetch full candidate rows for the given song ids (chunked ≤100), scoped to
 * the requester's library. `genres`/`moods` merge the AI and user tag names.
 * Returns rows keyed for the caller to reorder — order here is not meaningful.
 */
export const fetchCandidateRows = async (
  supabase: Client,
  songIds: string[],
): Promise<CandidateRow[]> => {
  const rows: CandidateRow[] = []
  for (let i = 0; i < songIds.length; i += CANDIDATE_FETCH_CHUNK) {
    const chunk = songIds.slice(i, i + CANDIDATE_FETCH_CHUNK)
    const { data, error } = await supabase
      .from('user_songs')
      .select(
        `song_id, songs!inner(
          id, title, artists, album_art_url, duration_ms, ai_attributes,
          song_genres(genres(name)),
          song_moods(moods(name)),
          user_genres(genres(name)),
          user_moods(moods(name))
        )`,
      )
      .in('song_id', chunk)
    if (error) throw new Error(error.message)
    for (const row of data) {
      const song = row.songs
      const genres = dedupe([
        ...song.song_genres.map((link) => link.genres.name),
        ...song.user_genres.map((link) => link.genres.name),
      ])
      const moods = dedupe([
        ...song.song_moods.map((link) => link.moods.name),
        ...song.user_moods.map((link) => link.moods.name),
      ])
      rows.push({
        songId: row.song_id,
        title: song.title,
        artists: song.artists ?? [],
        albumArtUrl: song.album_art_url,
        durationMs: song.duration_ms,
        attributes: readSongAIAttributes(song.ai_attributes),
        genres,
        moods,
      })
    }
  }
  return rows
}
