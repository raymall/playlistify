// Minimal typed Spotify Web API client for the import pipeline. Every response
// is parsed from `unknown` with guard helpers — no `as` casts, so malformed or
// partial payloads degrade to nulls/empties instead of throwing mid-batch.

import { isRecord, readNumber, readString } from '@/lib/json'

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'

/** Max page size the Saved Tracks endpoint accepts. */
export const LIKED_TRACKS_PAGE_SIZE = 50

/** Max ids the Get Several Artists endpoint accepts per call. */
const ARTIST_CHUNK_SIZE = 50

/** Max URIs the Check User's Saved Items endpoint accepts per call. */
const LIBRARY_CONTAINS_CHUNK_SIZE = 40

/** Max page size the Current User's Playlists endpoint accepts. */
const USER_PLAYLISTS_PAGE_SIZE = 50

/** Bounded to Spotify's documented 10,000-playlist library ceiling. */
const USER_PLAYLISTS_PAGE_CAP = 200

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

export type SpotifyPlaylistMetadata = {
  description: string | null
  id: string
  imageUrl: string | null
  name: string
}

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null

const readArray = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value : null

const readBooleanArray = (value: unknown): boolean[] | null => {
  const raw = readArray(value)
  if (raw === null || raw.some((entry) => typeof entry !== 'boolean')) {
    return null
  }
  return raw.map((entry) => entry === true)
}

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

/**
 * Reduce a completed Spotify Response to a SpotifyApiResult, parsing the JSON
 * body on success. Shared by the GET and POST wrappers so the 429/401/403/!ok
 * mapping stays identical.
 */
const reduceResponse = async (
  response: Response,
): Promise<SpotifyApiResult<unknown>> => {
  if (response.status === 429) {
    return {
      status: 'rate_limited',
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    }
  }

  // Log the raw failure body server-side before it is reduced to a status.
  // A bare `auth_failed` once masked a retired endpoint path as an expired
  // Spotify connection — the body ("Forbidden" vs. a scope error) is the only
  // thing that distinguishes them.
  if (!response.ok) {
    let body = ''
    try {
      body = (await response.text()).slice(0, 300)
    } catch {
      body = '(unreadable body)'
    }
    console.error(
      `[spotify] ${response.status} ${new URL(response.url).pathname}: ${body}`,
    )
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
  return reduceResponse(response)
}

/**
 * Single POST against the Spotify API with a JSON body, reduced to a
 * SpotifyApiResult. 201 (playlist created, tracks added) passes `response.ok`.
 */
const spotifyPost = async (
  accessToken: string,
  url: string,
  body: unknown,
): Promise<SpotifyApiResult<unknown>> => {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Spotify request failed',
    }
  }
  return reduceResponse(response)
}

/**
 * Send a status-only Spotify mutation. Successful empty bodies are never
 * parsed; failures still share the standard auth/rate-limit/error reduction.
 */
export const spotifySend = async (
  accessToken: string,
  url: string,
  method: 'DELETE' | 'PUT',
  body?: unknown,
): Promise<SpotifyApiResult<null>> => {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Spotify request failed',
    }
  }

  if (response.ok) return { status: 'ok', data: null }
  const result = await reduceResponse(response)
  return result.status === 'ok' ? { status: 'ok', data: null } : result
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
 * Confirm whether track ids are still in the current user's Spotify library.
 * The generalized `/me/library/contains` endpoint replaced the retired
 * track-specific endpoint and accepts at most 40 URIs per request.
 */
export const fetchSavedTrackStates = async (
  accessToken: string,
  trackIds: string[],
): Promise<SpotifyApiResult<Map<string, boolean>>> => {
  const states = new Map<string, boolean>()
  for (
    let index = 0;
    index < trackIds.length;
    index += LIBRARY_CONTAINS_CHUNK_SIZE
  ) {
    const chunk = trackIds.slice(index, index + LIBRARY_CONTAINS_CHUNK_SIZE)
    const uris = chunk.map((trackId) => `spotify:track:${trackId}`).join(',')
    const query = new URLSearchParams({ uris })
    const result = await spotifyGet(
      accessToken,
      `${SPOTIFY_API_BASE}/me/library/contains?${query.toString()}`,
    )
    if (result.status !== 'ok') return result
    const chunkStates = readBooleanArray(result.data)
    if (chunkStates?.length !== chunk.length) {
      return {
        status: 'error',
        message: 'Unexpected saved-items payload',
      }
    }
    for (let chunkIndex = 0; chunkIndex < chunk.length; chunkIndex += 1) {
      states.set(chunk[chunkIndex], chunkStates[chunkIndex])
    }
  }
  return { status: 'ok', data: states }
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

/**
 * Fetch every playlist currently in the user's Spotify library.
 *
 * This is the one playlist-management call that needs the
 * `playlist-read-private` scope. It uses `GET /me/playlists`; unlike the
 * retired create endpoint, the current create form is `POST /me/playlists`.
 */
export const fetchUserPlaylists = async (
  accessToken: string,
): Promise<SpotifyApiResult<Map<string, SpotifyPlaylistMetadata>>> => {
  const playlists = new Map<string, SpotifyPlaylistMetadata>()
  for (let pageIndex = 0; pageIndex < USER_PLAYLISTS_PAGE_CAP; pageIndex += 1) {
    const offset = pageIndex * USER_PLAYLISTS_PAGE_SIZE
    const url = `${SPOTIFY_API_BASE}/me/playlists?limit=${USER_PLAYLISTS_PAGE_SIZE}&offset=${offset}`
    const result = await spotifyGet(accessToken, url)
    if (result.status !== 'ok') return result
    if (!isRecord(result.data)) {
      return { status: 'error', message: 'Unexpected playlists payload' }
    }
    const items = readArray(result.data.items)
    if (items === null) {
      return { status: 'error', message: 'Unexpected playlists payload' }
    }
    for (const item of items) {
      if (!isRecord(item)) continue
      const id = readString(item.id)
      const name = readString(item.name)
      if (
        id === null ||
        id.length === 0 ||
        name === null ||
        name.length === 0
      ) {
        return { status: 'error', message: 'Unexpected playlist item' }
      }
      playlists.set(id, {
        description: readString(item.description),
        id,
        imageUrl: parseImages(item.images)[0]?.url ?? null,
        name,
      })
    }
    if (items.length < USER_PLAYLISTS_PAGE_SIZE) {
      return { status: 'ok', data: playlists }
    }
  }

  return {
    status: 'error',
    message: 'Spotify playlist scan exceeded the safe page limit',
  }
}

/** Max track uris the Add Items to Playlist endpoint accepts per request. */
export const PLAYLIST_ADD_CHUNK_SIZE = 100

export interface SpotifyCreatedPlaylist {
  id: string
  url: string | null
}

/**
 * Create a private playlist for the current user and return its id + web url.
 * `public: false` — the app never creates public playlists.
 *
 * Uses `POST /me/playlists`: Spotify's Feb 2026 Web API migration retired the
 * old `POST /users/{id}/playlists` form for Development Mode apps, which now
 * 403s ("Forbidden") for every caller. `/me/playlists` needs no user id.
 */
export const createSpotifyPlaylist = async (
  accessToken: string,
  details: { name: string; description: string },
): Promise<SpotifyApiResult<SpotifyCreatedPlaylist>> => {
  const url = `${SPOTIFY_API_BASE}/me/playlists`
  const result = await spotifyPost(accessToken, url, {
    name: details.name,
    description: details.description,
    public: false,
  })
  if (result.status !== 'ok') return result
  if (!isRecord(result.data)) {
    return { status: 'error', message: 'Unexpected playlist payload' }
  }
  const id = readString(result.data.id)
  if (id === null || id.length === 0) {
    return { status: 'error', message: 'Spotify playlist has no id' }
  }
  const externalUrls = result.data.external_urls
  const spotifyUrl = isRecord(externalUrls)
    ? readString(externalUrls.spotify)
    : null
  return { status: 'ok', data: { id, url: spotifyUrl } }
}

/**
 * Add one chunk (≤100) of track ids to a playlist, in order. Track ids are the
 * bare Spotify ids; they're expanded to `spotify:track:` uris here. The caller
 * owns the chunk loop and partial-failure accounting.
 *
 * Path is `/items`, NOT the older `/tracks`: Spotify's API migration renamed
 * the playlist-contents segment, and the retired `/tracks` form now 403s
 * ("Forbidden") for every caller — indistinguishable from a permissions
 * problem unless the response body is read.
 */
export const addPlaylistTracksChunk = async (
  accessToken: string,
  playlistId: string,
  trackIds: string[],
): Promise<SpotifyApiResult<null>> => {
  const url = `${SPOTIFY_API_BASE}/playlists/${encodeURIComponent(playlistId)}/items`
  const result = await spotifyPost(accessToken, url, {
    uris: trackIds.map((trackId) => `spotify:track:${trackId}`),
  })
  if (result.status !== 'ok') return result
  return { status: 'ok', data: null }
}

/** Update a playlist's title and description; Spotify returns an empty body. */
export const updateSpotifyPlaylistDetails = async (
  accessToken: string,
  playlistId: string,
  details: { name: string; description: string },
): Promise<SpotifyApiResult<null>> => {
  const url = `${SPOTIFY_API_BASE}/playlists/${encodeURIComponent(playlistId)}`
  return spotifySend(accessToken, url, 'PUT', details)
}

/**
 * Remove a playlist from the user's library by unfollowing it — Spotify has no
 * hard-delete for playlists; unfollow is what its own clients call "delete".
 * Used only to clean up a playlist this app created moments earlier and then
 * failed to fill, so an empty shell is never left behind.
 */
export const deleteSpotifyPlaylist = async (
  accessToken: string,
  playlistId: string,
): Promise<SpotifyApiResult<null>> => {
  const url = `${SPOTIFY_API_BASE}/playlists/${encodeURIComponent(playlistId)}/followers`
  return spotifySend(accessToken, url, 'DELETE')
}
