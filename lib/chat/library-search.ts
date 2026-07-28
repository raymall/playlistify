// Server-only query layer for chat library selection. Supabase REST caps
// responses at 1000 rows, so scans that can exceed that page with `.range()`.
// Every query runs on the request's RLS client, so results are user-scoped by
// construction; AI link tables (song_genres/song_moods) are shared, but the
// selectable-index intersection re-scopes them to the requester's own songs.
// The tag menu and the candidate universe both come from security-invoker
// RPCs (library_tag_names / library_selectable_songs) rather than app-side
// scans, so neither is bounded by how many rows the app is willing to page.

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  readSongAIAttributes,
  type SongAIAttributes,
} from '@/lib/enrichment/schema'
import type { Database } from '@/lib/supabase/types'

type Client = SupabaseClient<Database>

const PAGE_SIZE = 1000

/** One vocabulary row present in the library. */
export interface LibraryTag {
  id: string
  name: string
}

/**
 * The complete genre/mood vocabulary present in the library, plus head counts.
 * This is both what the assistant is shown and what it may search, so ids ride
 * along with the names — see `createChatTools`.
 */
export interface LibraryTagSummary {
  genres: LibraryTag[]
  moods: LibraryTag[]
  totalSongs: number
  selectableSongs: number
}

export interface SelectableIndexEntry {
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

const dedupe = (names: Iterable<string>): string[] => [...new Set(names)]

const byName = (a: LibraryTag, b: LibraryTag): number =>
  a.name.localeCompare(b.name)

/**
 * Head counts + the complete genre/mood vocabulary present in the user's
 * library, AI-linked or personally tagged. Nothing is sampled or capped: the
 * assistant may only search names it has been shown, so a truncated list is a
 * silently unreachable slice of the library.
 */
export const getLibraryTagSummary = async (
  supabase: Client,
): Promise<LibraryTagSummary> => {
  const [totalResult, selectableResult] = await Promise.all([
    supabase
      .from('user_songs')
      .select('song_id', { count: 'exact', head: true }),
    supabase.rpc('library_selectable_songs', undefined, {
      count: 'exact',
      head: true,
    }),
  ])

  const genres: LibraryTag[] = []
  const moods: LibraryTag[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc('library_tag_names')
      .order('kind', { ascending: true })
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    for (const row of data) {
      const tag = { id: row.id, name: row.name }
      if (row.kind === 'genre') genres.push(tag)
      else moods.push(tag)
    }
    if (data.length < PAGE_SIZE) break
  }

  return {
    genres: genres.sort(byName),
    moods: moods.sort(byName),
    totalSongs: totalResult.count ?? 0,
    selectableSongs: selectableResult.count ?? 0,
  }
}

/**
 * The candidate universe every search intersects against, most-recently-liked
 * first: songs the AI enriched OR songs the user tagged by hand. The RPC does
 * the ordering (recency, song_id tiebreak) so `.range()` pagination can't skip
 * or duplicate rows.
 */
export const getSelectableLibraryIndex = async (
  supabase: Client,
): Promise<SelectableIndexEntry[]> => {
  const entries: SelectableIndexEntry[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc('library_selectable_songs')
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
