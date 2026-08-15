// Server-only query layer for /library, mirroring the role lib/chat/
// library-search.ts plays for the assistant. Postgres owns the filtering,
// counting, ordering, and paging (library_search_page); this module only turns
// URL state into RPC arguments and hydrates the thin id list it returns.
//
// Thin ids plus a hydration pass, rather than fat jsonb rows: a jsonb column
// types as `Json`, so every one of the six tag embeds below would become
// hand-parsed instead of generated.

import type { SupabaseClient } from '@supabase/supabase-js'

import { readSongAIAttributes } from '@/lib/enrichment/schema'
import {
  LIBRARY_PAGE_SIZE,
  type LibrarySearchState,
} from '@/lib/library/search-params'
import { type LibrarySong } from '@/lib/library/song'
import type { Database } from '@/lib/supabase/types'

/** Beyond this the recheck filters stop narrowing anything worth the parse. */
const MAX_SEARCH_TERMS = 6

/**
 * The user_genres/user_moods embeds return only the requester's rows because
 * this runs on the RLS client — RLS is the only scoping.
 */
const SONG_EMBED = `song_id, songs!inner(
  id, title, artists, album_art_url, enrichment_status,
  ai_confidence, ai_attributes,
  song_genres(genre_id, genres(name)),
  song_moods(mood_id, moods(name)),
  user_genres(genre_id, genres(name)),
  user_moods(mood_id, moods(name)),
  user_genre_suppressions(genre_id, genres(name)),
  user_mood_suppressions(mood_id, moods(name))
)`

export type LibrarySearchResult = {
  songs: LibrarySong[]
  filteredCount: number
  pageCount: number
}

/**
 * Whitespace-split, lowercased, deduped, longest first. Longest first matters:
 * the RPC seeds its index scan from the first term and rechecks the rest, so
 * the most selective pattern should be the one Postgres can use an index for.
 */
const toSearchTerms = (query: string): string[] => {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length > 0),
    ),
  ]
  terms.sort((a, b) => b.length - a.length)
  return terms.slice(0, MAX_SEARCH_TERMS)
}

export const searchLibrary = async (
  supabase: SupabaseClient<Database>,
  state: LibrarySearchState,
  totalSongs: number,
): Promise<LibrarySearchResult> => {
  const terms = toSearchTerms(state.query)
  const hasFilters =
    terms.length > 0 ||
    state.genres.length > 0 ||
    state.moods.length > 0 ||
    state.bands.length > 0

  // With nothing filtered the count equals the library total, which the page
  // already has from library_enrichment_counts — so don't pay for it twice.
  const pageResult = await supabase.rpc('library_search_page', {
    p_terms: terms,
    p_genres: state.genres,
    p_moods: state.moods,
    p_bands: state.bands,
    p_limit: LIBRARY_PAGE_SIZE,
    p_offset: (state.page - 1) * LIBRARY_PAGE_SIZE,
    p_with_count: hasFilters,
  })
  if (pageResult.error !== null) throw new Error(pageResult.error.message)

  const songIds = pageResult.data.map((row) => row.song_id)
  const filteredCount = hasFilters
    ? (pageResult.data.at(0)?.total_count ?? 0)
    : totalSongs
  const pageCount = Math.max(1, Math.ceil(filteredCount / LIBRARY_PAGE_SIZE))

  if (songIds.length === 0) return { songs: [], filteredCount, pageCount }

  const rowsResult = await supabase
    .from('user_songs')
    .select(SONG_EMBED)
    .in('song_id', songIds)
  if (rowsResult.error !== null) throw new Error(rowsResult.error.message)

  const songBySongId = new Map(
    rowsResult.data.map((row) => [
      row.songs.id,
      {
        id: row.songs.id,
        title: row.songs.title,
        artists: row.songs.artists,
        albumArtUrl: row.songs.album_art_url,
        enrichmentStatus: row.songs.enrichment_status,
        aiConfidence: row.songs.ai_confidence,
        aiAttributes: readSongAIAttributes(row.songs.ai_attributes),
        aiGenres: row.songs.song_genres.map((link) => ({
          id: link.genre_id,
          name: link.genres.name,
        })),
        aiMoods: row.songs.song_moods.map((link) => ({
          id: link.mood_id,
          name: link.moods.name,
        })),
        hiddenGenres: row.songs.user_genre_suppressions.map((link) => ({
          id: link.genre_id,
          name: link.genres.name,
        })),
        hiddenMoods: row.songs.user_mood_suppressions.map((link) => ({
          id: link.mood_id,
          name: link.moods.name,
        })),
        userGenres: row.songs.user_genres.map((link) => ({
          id: link.genre_id,
          name: link.genres.name,
        })),
        userMoods: row.songs.user_moods.map((link) => ({
          id: link.mood_id,
          name: link.moods.name,
        })),
      },
    ]),
  )

  // Reorder to the RPC's order, which is the only authoritative one. A song can
  // leave the library between the two queries, so don't assume every id lands.
  const songs = songIds.flatMap((songId) => {
    const song = songBySongId.get(songId)
    return song === undefined ? [] : [song]
  })

  return { songs, filteredCount, pageCount }
}
