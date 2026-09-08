import type { SupabaseClient } from '@supabase/supabase-js'

import {
  fetchArtistGenres,
  type SavedTrackItem,
  type SpotifyTrack,
} from '@/lib/spotify/api'
import type { Database, TablesInsert } from '@/lib/supabase/types'

/**
 * Shared song-import helpers for the library sync engine (`sync.ts`): the
 * Spotify → `songs` row mapping and the shared-table upsert. Nothing here
 * touches a per-user table.
 */

export type ImportErrorResponse = {
  status: 'error'
  message: string
  safeToRetry?: boolean
}

const TRANSIENT_FETCH_FAILURE_PATTERN =
  /fetch failed|network request failed|connect timeout|socket disconnected/i

export const isTransientImportFailure = (message: string) =>
  TRANSIENT_FETCH_FAILURE_PATTERN.test(message)

/**
 * A transport-level failure is reported as `safeToRetry`: every sync write is
 * idempotent, so the client may repeat the same cursor for free.
 */
export const importFailure = (message: string): ImportErrorResponse =>
  isTransientImportFailure(message)
    ? {
        status: 'error',
        message: 'The import service connection was interrupted.',
        safeToRetry: true,
      }
    : { status: 'error', message }

/**
 * The nine Spotify-sourced metadata columns a song row may set. Enrichment
 * never writes `songs` from TypeScript (canonical writes happen inside
 * `promote_song_enrichment_attempt`), so the two writers cannot collide.
 * Every key is optional in the generated insert type; `mapTrack` always
 * materialises all nine, and `mapAlbumTrack` omits `popularity` — a
 * simplified album track has none, and an omitted key leaves a liked song's
 * value alone on conflict-update.
 */
export type SongMetadata = Pick<
  TablesInsert<'songs'>,
  | 'spotify_track_id'
  | 'title'
  | 'artists'
  | 'album'
  | 'album_art_url'
  | 'duration_ms'
  | 'release_date'
  | 'popularity'
  | 'explicit'
>

export type MappedTrack = {
  row: SongMetadata
  artistIds: string[]
  /** When the source says the song was added; null when Spotify omitted it. */
  addedAt: string | null
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONTH_PATTERN = /^\d{4}-\d{2}$/
const YEAR_PATTERN = /^\d{4}$/

/**
 * Normalise Spotify's variable-precision release date to a full `YYYY-MM-DD`
 * the `date` column accepts, or null when it can't be trusted. Year `0000`
 * (Spotify's "unknown") is always rejected.
 */
export const normalizeReleaseDate = (
  raw: string | null,
  precision: string | null,
): string | null => {
  if (raw === null || raw.startsWith('0000')) return null
  if (precision === 'day' && DAY_PATTERN.test(raw)) return raw
  if (precision === 'month' && MONTH_PATTERN.test(raw)) return `${raw}-01`
  if (precision === 'year' && YEAR_PATTERN.test(raw)) return `${raw}-01-01`
  return null
}

/** The eight columns every source can vouch for — null where unknown. */
const buildSongRow = (
  track: SpotifyTrack,
): Omit<SongMetadata, 'popularity'> => {
  const { images } = track.album
  return {
    spotify_track_id: track.id,
    title: track.name,
    artists: track.artists.map((artist) => artist.name),
    album: track.album.name,
    album_art_url: images.length > 0 ? images[0].url : null,
    duration_ms: track.duration_ms,
    release_date: normalizeReleaseDate(
      track.album.release_date,
      track.album.release_date_precision,
    ),
    explicit: track.explicit,
  }
}

const collectArtistIds = (track: SpotifyTrack): string[] => {
  const artistIds: string[] = []
  for (const artist of track.artists) {
    if (artist.id !== null) artistIds.push(artist.id)
  }
  return artistIds
}

/**
 * Map a full track object (Liked Songs, playlist items) to a song row + its
 * artist ids. The row always materialises the same nine keys, so bulk upsert
 * payloads are uniform by construction.
 */
export const mapTrack = (
  track: SpotifyTrack,
  addedAt: string | null,
): MappedTrack => ({
  row: { ...buildSongRow(track), popularity: track.popularity },
  artistIds: collectArtistIds(track),
  addedAt,
})

/**
 * Map a simplified album track. The row omits `popularity` on purpose: the
 * endpoint never reports it, and an omitted key cannot clobber the value a
 * Liked Songs read already stored for the same song.
 */
export const mapAlbumTrack = (
  track: SpotifyTrack,
  addedAt: string | null,
): MappedTrack => ({
  row: buildSongRow(track),
  artistIds: collectArtistIds(track),
  addedAt,
})

/**
 * Map a raw saved-track entry (Liked Songs or a playlist item). Returns null
 * for entries with no usable track (local files, episodes, unparseable items).
 */
export const mapSavedTrack = (item: SavedTrackItem): MappedTrack | null =>
  item.track === null ? null : mapTrack(item.track, item.added_at)

/**
 * Dedupe mapped tracks by Spotify id: offset drift can repeat a track across
 * pages, and duplicate conflict keys in a single INSERT are a Postgres error.
 */
export const dedupeMappedTracks = (
  tracks: (MappedTrack | null)[],
): MappedTrack[] => {
  const byTrackId = new Map<string, MappedTrack>()
  for (const track of tracks) {
    if (track !== null) byTrackId.set(track.row.spotify_track_id, track)
  }
  return [...byTrackId.values()]
}

export type SongUpsertResult =
  | { status: 'ok'; songIdByTrackId: Map<string, string> }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | ImportErrorResponse

/**
 * Upsert song rows for the mapped tracks and return song ids by Spotify id.
 * Songs already carrying genres get a metadata-only upsert; the rest get an
 * artist-genre lookup first, which degrades to `[]` — never null — when the
 * batch `/artists` endpoint refuses (it 403s for this app). A rate limit on
 * that lookup returns before any write, so no row lands partially genre'd.
 */
export const upsertSongs = async (
  admin: SupabaseClient<Database>,
  accessToken: string,
  mappedTracks: MappedTrack[],
): Promise<SongUpsertResult> => {
  const songIdByTrackId = new Map<string, string>()
  if (mappedTracks.length === 0) return { status: 'ok', songIdByTrackId }

  // Which of these songs already carry genres? Their artists' genres never need
  // re-fetching — the whole point of the step-4 optimisation.
  const trackIds = mappedTracks.map((track) => track.row.spotify_track_id)
  const existing = await admin
    .from('songs')
    .select('spotify_track_id')
    .in('spotify_track_id', trackIds)
    .not('spotify_genres', 'is', null)
  if (existing.error) return importFailure(existing.error.message)

  const trackIdsWithGenres = new Set(
    existing.data.map((row) => row.spotify_track_id),
  )
  const needsGenres = mappedTracks.filter(
    (track) => !trackIdsWithGenres.has(track.row.spotify_track_id),
  )
  const hasGenres = mappedTracks.filter((track) =>
    trackIdsWithGenres.has(track.row.spotify_track_id),
  )

  // Resolve genres for the songs missing them — best-effort. A rate limit
  // returns before ANY write, so no row lands partially genre'd; the client
  // retries the same cursor and the idempotent upserts absorb the repeat.
  const genresByTrackId = new Map<string, string[]>()
  if (needsGenres.length > 0) {
    const artistIdSet = new Set<string>()
    for (const track of needsGenres) {
      for (const artistId of track.artistIds) artistIdSet.add(artistId)
    }

    const genresResult = await fetchArtistGenres(accessToken, [...artistIdSet])
    if (genresResult.status === 'rate_limited') {
      return {
        status: 'rate_limited',
        retryAfterSeconds: genresResult.retryAfterSeconds,
      }
    }

    // Genres are optional and a deferred step-5 concern. Spotify's batch
    // "Get Several Artists" endpoint is forbidden (403) for apps without
    // extended quota, even though the library reads succeed with the same
    // token — so the valid token already proved itself on the page fetch. On
    // any auth failure or error here, degrade to empty genres and keep
    // importing rather than derailing the whole sync. Songs land with
    // spotify_genres = [] (never null), so the invariant and the
    // needs-genres optimisation both stay sound.
    if (genresResult.status === 'ok') {
      const genresByArtist = genresResult.data
      for (const track of needsGenres) {
        const genreSet = new Set<string>()
        for (const artistId of track.artistIds) {
          const artistGenres = genresByArtist.get(artistId)
          if (artistGenres === undefined) continue
          for (const genre of artistGenres) genreSet.add(genre)
        }
        genresByTrackId.set(track.row.spotify_track_id, [...genreSet])
      }
    }
  }

  // Invariant: song payloads carry ONLY the nine metadata keys (+ spotify_genres
  // for the needsGenres group), which `SongMetadata` enforces at compile time.
  // They never include any enrichment column (those are written only by the
  // promote_song_enrichment_attempt RPC), nor apple_music_id or id. Omitted
  // columns are untouched on conflict-update and take their defaults on
  // insert — so new songs land 'pending' and a re-sync can never reset an
  // already-enriched song.
  const upsertPayload = async (
    payload: TablesInsert<'songs'>[],
  ): Promise<ImportErrorResponse | null> => {
    if (payload.length === 0) return null
    const result = await admin
      .from('songs')
      .upsert(payload, { onConflict: 'spotify_track_id' })
      .select('id, spotify_track_id')
    if (result.error) return importFailure(result.error.message)
    for (const songRow of result.data) {
      songIdByTrackId.set(songRow.spotify_track_id, songRow.id)
    }
    return null
  }

  const needsGenresError = await upsertPayload(
    needsGenres.map((track) => ({
      ...track.row,
      spotify_genres: genresByTrackId.get(track.row.spotify_track_id) ?? [],
    })),
  )
  if (needsGenresError !== null) return needsGenresError

  // Metadata only — refreshes popularity/art, never touches existing genres.
  const hasGenresError = await upsertPayload(
    hasGenres.map((track) => track.row),
  )
  if (hasGenresError !== null) return hasGenresError

  return { status: 'ok', songIdByTrackId }
}
