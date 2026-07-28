import {
  fetchArtistGenres,
  fetchLikedTracksPage,
  LIKED_TRACKS_PAGE_SIZE,
  type SavedTrackItem,
} from '@/lib/spotify/api'
import { getValidSpotifyToken } from '@/lib/spotify/token'
import { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'

/**
 * Route → client response. HTTP 200 for every non-error status (`rate_limited`
 * is data, not an HTTP 429 from us); the client parses this one union.
 */
export type ImportBatchResponse =
  | {
      status: 'progress'
      nextOffset: number
      total: number
      importedCount: number
    }
  | { status: 'done'; total: number; importedCount: number }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'reconnect_required' }
  | { status: 'error'; message: string }

/**
 * Pages fetched per invocation. Two pages (100 tracks) keeps each call well
 * inside serverless limits (~1.5–2.5s) while minimising round-trips.
 */
const PAGES_PER_BATCH = 2

/**
 * The nine Spotify-sourced metadata columns every song row always sets — the
 * mirror image of `EnrichmentWrite` in `lib/enrichment/engine.ts`. Between the
 * two, neither writer can reach the other's columns without a compile error.
 */
type SongMetadata = Pick<
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

interface MappedTrack {
  row: SongMetadata
  artistIds: string[]
  likedAt: string | null
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONTH_PATTERN = /^\d{4}-\d{2}$/
const YEAR_PATTERN = /^\d{4}$/

/**
 * Normalise Spotify's variable-precision release date to a full `YYYY-MM-DD`
 * the `date` column accepts, or null when it can't be trusted. Year `0000`
 * (Spotify's "unknown") is always rejected.
 */
const normalizeReleaseDate = (
  raw: string | null,
  precision: string | null,
): string | null => {
  if (raw === null || raw.startsWith('0000')) return null
  if (precision === 'day' && DAY_PATTERN.test(raw)) return raw
  if (precision === 'month' && MONTH_PATTERN.test(raw)) return `${raw}-01`
  if (precision === 'year' && YEAR_PATTERN.test(raw)) return `${raw}-01-01`
  return null
}

/**
 * Map a raw saved-track entry to a song row + its artist ids. Returns null for
 * entries with no usable track (local files, unparseable items). The row always
 * materialises the same nine keys — null where unknown — so bulk upsert payloads
 * are uniform by construction.
 */
const mapSavedTrack = (item: SavedTrackItem): MappedTrack | null => {
  const { track } = item
  if (track === null) return null

  const { images } = track.album
  const row: SongMetadata = {
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
    popularity: track.popularity,
    explicit: track.explicit,
  }

  const artistIds: string[] = []
  for (const artist of track.artists) {
    if (artist.id !== null) artistIds.push(artist.id)
  }

  return { row, artistIds, likedAt: item.added_at }
}

/**
 * Import one batch (up to two pages) of the user's Liked Songs starting at
 * `offset`. Stateless per call — resumable by construction. All writes go
 * through the service-role client (`songs` is SELECT-only under RLS).
 */
export const importLikedSongsBatch = async (
  userId: string,
  offset: number,
): Promise<ImportBatchResponse> => {
  const tokenResult = await getValidSpotifyToken(userId)
  if (tokenResult.status === 'reconnect_required') {
    return { status: 'reconnect_required' }
  }
  if (tokenResult.status === 'error') {
    return { status: 'error', message: tokenResult.message }
  }
  const { accessToken } = tokenResult

  const items: SavedTrackItem[] = []
  let total = 0
  let lastPageNext: string | null = null

  for (let pageIndex = 0; pageIndex < PAGES_PER_BATCH; pageIndex += 1) {
    const pageOffset = offset + pageIndex * LIKED_TRACKS_PAGE_SIZE
    // Stop once the previous page was the last one, or we've passed the total.
    if (pageIndex > 0 && (lastPageNext === null || pageOffset >= total)) break

    const pageResult = await fetchLikedTracksPage(accessToken, pageOffset)
    if (pageResult.status === 'auth_failed') {
      return { status: 'reconnect_required' }
    }
    if (pageResult.status === 'error') {
      return { status: 'error', message: pageResult.message }
    }
    if (pageResult.status === 'rate_limited') {
      // The first page must surface the rate limit so the client waits. A later
      // page is instead dropped and retried next invocation: the collected item
      // count hasn't advanced past it, so the next call resumes at its offset
      // and meets the 429 cleanly.
      if (pageIndex === 0) {
        return {
          status: 'rate_limited',
          retryAfterSeconds: pageResult.retryAfterSeconds,
        }
      }
      break
    }

    const page = pageResult.data
    total = page.total
    items.push(...page.items)
    lastPageNext = page.next
  }

  // Dedupe by track id: offset drift can repeat a track across pages, and
  // duplicate conflict keys in a single INSERT are a Postgres error.
  const mappedByTrackId = new Map<string, MappedTrack>()
  for (const item of items) {
    const mapped = mapSavedTrack(item)
    if (mapped !== null)
      mappedByTrackId.set(mapped.row.spotify_track_id, mapped)
  }
  const mappedTracks = [...mappedByTrackId.values()]

  const nextOffset = offset + items.length
  const isDone = nextOffset >= total || lastPageNext === null

  // Nothing to write (empty library, or an all-local batch): still advance.
  if (mappedTracks.length === 0) {
    return isDone
      ? { status: 'done', total, importedCount: 0 }
      : { status: 'progress', nextOffset, total, importedCount: 0 }
  }

  const admin = createAdminClient()

  // Which of these songs already carry genres? Their artists' genres never need
  // re-fetching — the whole point of the step-4 optimisation.
  const trackIds = mappedTracks.map((track) => track.row.spotify_track_id)
  const existing = await admin
    .from('songs')
    .select('spotify_track_id')
    .in('spotify_track_id', trackIds)
    .not('spotify_genres', 'is', null)
  if (existing.error)
    return { status: 'error', message: existing.error.message }

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
  // retries the same offset and the idempotent upserts absorb the repeat.
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
    // extended quota, even though /me/tracks and single-artist reads succeed
    // with the same token — so the valid token already proved itself on the
    // page fetch above. On any auth failure or error here, degrade to empty
    // genres and keep importing rather than derailing the whole import. Songs
    // land with spotify_genres = [] (never null), so the invariant and the
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
  // They never include any of the eight enrichment columns (`EnrichmentWrite`
  // in lib/enrichment/engine.ts), nor apple_music_id or id. Omitted columns are
  // untouched on conflict-update and take their defaults on insert — so new
  // songs land 'pending' and a re-sync can never reset an already-enriched song.
  const songIdByTrackId = new Map<string, string>()
  const upsertSongs = async (
    payload: TablesInsert<'songs'>[],
  ): Promise<{ status: 'error'; message: string } | null> => {
    if (payload.length === 0) return null
    const result = await admin
      .from('songs')
      .upsert(payload, { onConflict: 'spotify_track_id' })
      .select('id, spotify_track_id')
    if (result.error) return { status: 'error', message: result.error.message }
    for (const songRow of result.data) {
      songIdByTrackId.set(songRow.spotify_track_id, songRow.id)
    }
    return null
  }

  const needsGenresError = await upsertSongs(
    needsGenres.map((track) => ({
      ...track.row,
      spotify_genres: genresByTrackId.get(track.row.spotify_track_id) ?? [],
    })),
  )
  if (needsGenresError !== null) return needsGenresError

  // Metadata only — refreshes popularity/art, never touches existing genres.
  const hasGenresError = await upsertSongs(hasGenres.map((track) => track.row))
  if (hasGenresError !== null) return hasGenresError

  // `liked_at` self-heals an unlike/re-like; `imported_at` is omitted so it
  // defaults on insert and stays put on update.
  const userSongsPayload: TablesInsert<'user_songs'>[] = []
  for (const track of mappedTracks) {
    const songId = songIdByTrackId.get(track.row.spotify_track_id)
    if (songId === undefined) continue
    userSongsPayload.push({
      user_id: userId,
      song_id: songId,
      liked_at: track.likedAt,
    })
  }

  if (userSongsPayload.length > 0) {
    const result = await admin
      .from('user_songs')
      .upsert(userSongsPayload, { onConflict: 'user_id,song_id' })
    if (result.error) return { status: 'error', message: result.error.message }
  }

  const importedCount = userSongsPayload.length
  return isDone
    ? { status: 'done', total, importedCount }
    : { status: 'progress', nextOffset, total, importedCount }
}
