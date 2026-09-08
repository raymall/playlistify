// Row shapes for the /library table. They live here rather than on the
// component so the server-only data layer (lib/library/search.ts) can build
// them without importing from a component module.

import { type SongAIAttributes } from '@/lib/enrichment/schema'

/** One vocabulary row as it appears on a song: the shared id plus its name. */
export type LibraryTag = {
  id: string
  name: string
}

/**
 * Which Spotify sources hold the song in this user's library. `isLiked` is
 * the Liked Songs source; the counts are distinct owned playlists and saved
 * albums. At least one is set for every row (a song leaves the library when
 * none holds it).
 */
export type LibrarySongSources = {
  isLiked: boolean
  playlistCount: number
  albumCount: number
}

export type LibrarySong = {
  id: string
  title: string | null
  artists: string[] | null
  albumArtUrl: string | null
  enrichmentStatus: string
  aiConfidence: number | null
  aiAttributes: SongAIAttributes | null
  aiGenres: LibraryTag[]
  aiMoods: LibraryTag[]
  hiddenGenres: LibraryTag[]
  hiddenMoods: LibraryTag[]
  userGenres: LibraryTag[]
  userMoods: LibraryTag[]
  /** The recipe that produced this song's result; null before any promotion. */
  recipeLabel: string | null
  isCurrentRecipe: boolean
  sources: LibrarySongSources
}
