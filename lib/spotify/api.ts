// Minimal typed Spotify Web API client for the import pipeline. Every response
// is parsed from `unknown` with guard helpers — no `as` casts, so malformed or
// partial payloads degrade to nulls/empties instead of throwing mid-batch.

import { isRecord, readNumber, readString } from '@/lib/json'

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'

/** Max page size the Saved Tracks endpoint accepts. */
export const LIKED_TRACKS_PAGE_SIZE = 50

/** Max ids the Get Several Artists endpoint accepts per call. */
const ARTIST_CHUNK_SIZE = 50

const RETRY_AFTER_FALLBACK_SECONDS = 5
const RETRY_AFTER_MIN_SECONDS = 1
const RETRY_AFTER_MAX_SECONDS = 3600

export type SpotifyApiResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'auth_failed' }
  | { status: 'error'; message: string }

export interface SpotifyArtistRef {
  id: string | null
  name: string
}

export interface SpotifyImage {
  url: string
}

export interface SpotifyAlbum {
  name: string | null
  images: SpotifyImage[]
  release_date: string | null
  release_date_precision: string | null
}

export interface SpotifyTrack {
  id: string
  name: string
  artists: SpotifyArtistRef[]
  album: SpotifyAlbum
  duration_ms: number | null
  popularity: number | null
  explicit: boolean | null
}

/**
 * A raw Saved Tracks entry. `track` is null for local files, missing ids, or
 * otherwise unparseable items — the entry is still kept so `items.length`
 * drives offset math in lockstep with Spotify's paging.
 */
export interface SavedTrackItem {
  added_at: string | null
  track: SpotifyTrack | null
}

export interface LikedTracksPage {
  items: SavedTrackItem[]
  total: number
  next: string | null
}

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null

const readArray = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value : null

const readStringArray = (value: unknown): string[] => {
  const raw = readArray(value)
  if (raw === null) return []
  const strings: string[] = []
  for (const entry of raw) {
    const str = readString(entry)
    if (str !== null) strings.push(str)
  }
  return strings
}

const parseRetryAfter = (header: string | null): number => {
  if (header === null) return RETRY_AFTER_FALLBACK_SECONDS
  const parsed = Number.parseInt(header, 10)
  if (!Number.isFinite(parsed)) return RETRY_AFTER_FALLBACK_SECONDS
  return Math.min(
    Math.max(parsed, RETRY_AFTER_MIN_SECONDS),
    RETRY_AFTER_MAX_SECONDS,
  )
}

/** Single GET against the Spotify API, reduced to a SpotifyApiResult. */
const spotifyGet = async (
  accessToken: string,
  url: string,
): Promise<SpotifyApiResult<unknown>> => {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Spotify request failed',
    }
  }

  if (response.status === 429) {
    return {
      status: 'rate_limited',
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    }
  }
  if (response.status === 401 || response.status === 403) {
    return { status: 'auth_failed' }
  }
  if (!response.ok) {
    return {
      status: 'error',
      message: `Spotify request failed (HTTP ${response.status})`,
    }
  }

  try {
    const data: unknown = await response.json()
    return { status: 'ok', data }
  } catch {
    return {
      status: 'error',
      message: 'Spotify returned an unparseable response',
    }
  }
}

const parseImages = (value: unknown): SpotifyImage[] => {
  const raw = readArray(value)
  if (raw === null) return []
  const images: SpotifyImage[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const url = readString(entry.url)
    if (url === null || url.length === 0) continue
    images.push({ url })
  }
  return images
}

const parseArtists = (value: unknown): SpotifyArtistRef[] => {
  const raw = readArray(value)
  if (raw === null) return []
  const artists: SpotifyArtistRef[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const name = readString(entry.name)
    if (name === null || name.length === 0) continue
    artists.push({ id: readString(entry.id), name })
  }
  return artists
}

const parseAlbum = (value: unknown): SpotifyAlbum => {
  if (!isRecord(value)) {
    return {
      name: null,
      images: [],
      release_date: null,
      release_date_precision: null,
    }
  }
  return {
    name: readString(value.name),
    images: parseImages(value.images),
    release_date: readString(value.release_date),
    release_date_precision: readString(value.release_date_precision),
  }
}

const parseTrack = (value: unknown): SpotifyTrack | null => {
  if (!isRecord(value)) return null
  // Local files carry no stable metadata and cannot be added to playlists.
  if (value.is_local === true) return null
  const id = readString(value.id)
  if (id === null || id.length === 0) return null
  const name = readString(value.name)
  if (name === null || name.length === 0) return null
  return {
    id,
    name,
    artists: parseArtists(value.artists),
    album: parseAlbum(value.album),
    duration_ms: readNumber(value.duration_ms),
    popularity: readNumber(value.popularity),
    explicit: readBoolean(value.explicit),
  }
}

const parseSavedTrackItem = (value: unknown): SavedTrackItem => {
  if (!isRecord(value)) return { added_at: null, track: null }
  return {
    added_at: readString(value.added_at),
    track: parseTrack(value.track),
  }
}

const parseLikedTracksPage = (value: unknown): LikedTracksPage | null => {
  if (!isRecord(value)) return null
  const rawItems = readArray(value.items)
  const total = readNumber(value.total)
  if (rawItems === null || total === null) return null
  return {
    items: rawItems.map(parseSavedTrackItem),
    total,
    next: readString(value.next),
  }
}

const parseArtistGenres = (value: unknown): Map<string, string[]> | null => {
  if (!isRecord(value)) return null
  const rawArtists = readArray(value.artists)
  if (rawArtists === null) return null
  const genresByArtist = new Map<string, string[]>()
  for (const entry of rawArtists) {
    // Spotify pads the array with null for unknown ids — skip those.
    if (!isRecord(entry)) continue
    const id = readString(entry.id)
    if (id === null) continue
    genresByArtist.set(id, readStringArray(entry.genres))
  }
  return genresByArtist
}

/** Fetch one page (50 tracks) of the user's Saved Tracks at `offset`. */
export const fetchLikedTracksPage = async (
  accessToken: string,
  offset: number,
): Promise<SpotifyApiResult<LikedTracksPage>> => {
  const url = `${SPOTIFY_API_BASE}/me/tracks?limit=${LIKED_TRACKS_PAGE_SIZE}&offset=${offset}`
  const result = await spotifyGet(accessToken, url)
  if (result.status !== 'ok') return result
  const page = parseLikedTracksPage(result.data)
  if (page === null) {
    return { status: 'error', message: 'Unexpected liked tracks payload' }
  }
  return { status: 'ok', data: page }
}

/**
 * Resolve genres for the given artist ids, chunked ≤50 per request. Returns a
 * map of artist id → genres (missing `genres` becomes `[]`). Any non-ok result
 * (rate limit, auth failure) propagates so the caller can bail before writing.
 */
export const fetchArtistGenres = async (
  accessToken: string,
  artistIds: string[],
): Promise<SpotifyApiResult<Map<string, string[]>>> => {
  const genresByArtist = new Map<string, string[]>()
  for (let index = 0; index < artistIds.length; index += ARTIST_CHUNK_SIZE) {
    const chunk = artistIds.slice(index, index + ARTIST_CHUNK_SIZE)
    const url = `${SPOTIFY_API_BASE}/artists?ids=${chunk.join(',')}`
    const result = await spotifyGet(accessToken, url)
    if (result.status !== 'ok') return result
    const parsed = parseArtistGenres(result.data)
    if (parsed === null) {
      return { status: 'error', message: 'Unexpected artists payload' }
    }
    for (const [artistId, genres] of parsed) {
      genresByArtist.set(artistId, genres)
    }
  }
  return { status: 'ok', data: genresByArtist }
}
