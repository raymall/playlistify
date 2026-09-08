import type { SupabaseClient } from '@supabase/supabase-js'

import {
  fetchAlbumTracksPage,
  fetchLikedTracksPage,
  fetchPlaylistItemsPage,
  fetchSavedAlbumsPage,
  fetchSavedTrackStates,
  fetchUserPlaylists,
  LIKED_TRACKS_PAGE_SIZE,
  PLAYLIST_ITEMS_PAGE_SIZE,
  type PlaylistItemsResult,
  type SavedTrackItem,
  type SpotifySavedAlbum,
  type SpotifyTrack,
} from '@/lib/spotify/api'
import {
  dedupeMappedTracks,
  importFailure,
  mapAlbumTrack,
  type MappedTrack,
  mapSavedTrack,
  upsertSongs,
} from '@/lib/spotify/import'
import {
  SYNC_MAX_PLAYLISTS,
  type SyncBatchResponse,
  type SyncCursor,
} from '@/lib/spotify/sync-contract'
import { getValidSpotifyToken } from '@/lib/spotify/token'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, TablesInsert } from '@/lib/supabase/types'

/**
 * Pages fetched per invocation on the 50-item track endpoints (~100 tracks).
 * Keeps each call well inside serverless limits while minimising round-trips.
 * The albums phase reads one 20-album page per call instead: every album
 * embeds a page of tracks, so one listing page is already a comparable write.
 */
const PAGES_PER_BATCH = 2

const STALE_SCAN_PAGE_SIZE = 1000
/** Ids per `.in()` filter — keeps the request URL well under proxy limits. */
const ID_CHUNK_SIZE = 100

type SourceType = 'liked' | 'playlist' | 'album'

type SyncContext = {
  admin: SupabaseClient<Database>
  userId: string
  accessToken: string
  syncStartedAt: string
}

type SyncFailure = Extract<
  SyncBatchResponse,
  { status: 'error' | 'rate_limited' | 'reconnect_required' }
>

/** One source's contribution to a batch: its tracks, each with its added_at. */
type SourceTracks = {
  sourceType: SourceType
  sourceId: string
  tracks: MappedTrack[]
}

type WriteResult = { status: 'ok'; imported: number } | SyncFailure

/**
 * Persist one batch of source tracks: shared `songs` rows, the caller's
 * `user_songs` rows, and the `user_song_sources` membership rows behind them.
 * Every write is idempotent, so a repeated cursor is absorbed.
 *
 * Liked Songs is the one source whose added_at is the library row's
 * `liked_at` outright (an unlike/re-like self-heals), so it takes the full
 * upsert. Playlist and album rows may only *create* a library row — with the
 * source's added_at as its `liked_at`, which keeps the canonical library order
 * non-null — and never move an existing one; the RPC refreshes only the sync
 * marker on conflict.
 */
const writeSourceTracks = async (
  context: SyncContext,
  sources: SourceTracks[],
): Promise<WriteResult> => {
  const { admin, userId, accessToken, syncStartedAt } = context
  const allTracks = dedupeMappedTracks(
    sources.flatMap((source) => source.tracks),
  )
  if (allTracks.length === 0) return { status: 'ok', imported: 0 }

  const upsertResult = await upsertSongs(admin, accessToken, allTracks)
  if (upsertResult.status !== 'ok') return upsertResult
  const { songIdByTrackId } = upsertResult

  const likedRows: TablesInsert<'user_songs'>[] = []
  // Keyed by song id: the same song on two albums must reach the RPC once —
  // ON CONFLICT DO UPDATE cannot touch a row twice in one statement.
  const sourcedRows = new Map<string, { song_id: string; added_at: string }>()
  const sourceRows = new Map<string, TablesInsert<'user_song_sources'>>()
  for (const source of sources) {
    for (const track of source.tracks) {
      const songId = songIdByTrackId.get(track.row.spotify_track_id)
      if (songId === undefined) continue
      const addedAt = track.addedAt ?? syncStartedAt
      if (source.sourceType === 'liked') {
        likedRows.push({
          user_id: userId,
          song_id: songId,
          liked_at: track.addedAt,
          imported_at: syncStartedAt,
        })
      } else if (!sourcedRows.has(songId)) {
        sourcedRows.set(songId, { song_id: songId, added_at: addedAt })
      }
      sourceRows.set(`${source.sourceType}:${source.sourceId}:${songId}`, {
        user_id: userId,
        song_id: songId,
        source_type: source.sourceType,
        source_id: source.sourceId,
        added_at: addedAt,
        last_seen_at: syncStartedAt,
      })
    }
  }

  if (likedRows.length > 0) {
    const result = await admin
      .from('user_songs')
      .upsert(likedRows, { onConflict: 'user_id,song_id' })
    if (result.error) return importFailure(result.error.message)
  }
  if (sourcedRows.size > 0) {
    const result = await admin.rpc('import_user_songs_from_source', {
      p_user_id: userId,
      p_rows: [...sourcedRows.values()],
      p_synced_at: syncStartedAt,
    })
    if (result.error) return importFailure(result.error.message)
  }
  // The source row's FK needs the library row, so this write comes last.
  if (sourceRows.size > 0) {
    const result = await admin
      .from('user_song_sources')
      .upsert([...sourceRows.values()], {
        onConflict: 'user_id,song_id,source_type,source_id',
      })
    if (result.error) return importFailure(result.error.message)
  }

  return { status: 'ok', imported: sourceRows.size }
}

type TrackPageCollection =
  | {
      status: 'ok'
      items: SavedTrackItem[]
      total: number
      isLastPage: boolean
      isNotFound: boolean
    }
  | SyncFailure

/**
 * Read up to `PAGES_PER_BATCH` pages of a saved-track-shaped endpoint from
 * `startOffset`. A rate limit on the first page surfaces so the client waits;
 * on a later page it is dropped and met cleanly next call, because the
 * collected item count has not advanced past it. `not_found` (a playlist that
 * vanished mid-sync) ends the collection instead of failing it.
 */
const collectTrackPages = async (
  fetchPage: (offset: number) => Promise<PlaylistItemsResult>,
  startOffset: number,
  pageSize: number,
): Promise<TrackPageCollection> => {
  const items: SavedTrackItem[] = []
  let total = 0
  let lastPageNext: string | null = null
  let isNotFound = false

  for (let pageIndex = 0; pageIndex < PAGES_PER_BATCH; pageIndex += 1) {
    const pageOffset = startOffset + pageIndex * pageSize
    if (pageIndex > 0 && (lastPageNext === null || pageOffset >= total)) break

    const result = await fetchPage(pageOffset)
    if (result.status === 'not_found') {
      isNotFound = true
      break
    }
    if (result.status === 'auth_failed') return { status: 'reconnect_required' }
    if (result.status === 'error') return importFailure(result.message)
    if (result.status === 'rate_limited') {
      if (pageIndex === 0) {
        return {
          status: 'rate_limited',
          retryAfterSeconds: result.retryAfterSeconds,
        }
      }
      break
    }

    total = result.data.total
    items.push(...result.data.items)
    lastPageNext = result.data.next
  }

  return {
    status: 'ok',
    items,
    total,
    isLastPage:
      isNotFound ||
      lastPageNext === null ||
      items.length === 0 ||
      startOffset + items.length >= total,
    isNotFound,
  }
}

const runLikedBatch = async (
  context: SyncContext,
  cursor: Extract<SyncCursor, { phase: 'liked' }>,
): Promise<SyncBatchResponse> => {
  const { accessToken, syncStartedAt } = context
  const collected = await collectTrackPages(
    (offset) => fetchLikedTracksPage(accessToken, offset),
    cursor.offset,
    LIKED_TRACKS_PAGE_SIZE,
  )
  if (collected.status !== 'ok') return collected

  const written = await writeSourceTracks(context, [
    {
      sourceType: 'liked',
      sourceId: '',
      tracks: dedupeMappedTracks(collected.items.map(mapSavedTrack)),
    },
  ])
  if (written.status !== 'ok') return written

  const nextOffset = cursor.offset + collected.items.length
  if (!collected.isLastPage) {
    return {
      status: 'progress',
      syncStartedAt,
      next: { phase: 'liked', offset: nextOffset },
      phase: 'liked',
      phaseCurrent: Math.min(nextOffset, collected.total),
      phaseTotal: collected.total,
      batchImported: written.imported,
    }
  }
  return {
    status: 'progress',
    syncStartedAt,
    next: { phase: 'playlists', playlists: null, index: 0, itemOffset: 0 },
    phase: 'playlists',
    phaseCurrent: 0,
    phaseTotal: null,
    batchImported: written.imported,
  }
}

/**
 * The playlists phase's first batch: list the user's playlists once, keep the
 * ids of the ones they own, and hand the snapshot back in the cursor. Nothing
 * is imported here, so repeating it is free.
 */
const snapshotOwnedPlaylists = async (
  context: SyncContext,
): Promise<SyncBatchResponse> => {
  const { admin, userId, accessToken, syncStartedAt } = context
  const profile = await admin
    .from('profiles')
    .select('spotify_user_id')
    .eq('id', userId)
    .maybeSingle()
  if (profile.error) return importFailure(profile.error.message)
  // The Spotify user id is captured at sign-in; a profile without one
  // predates that capture, and a fresh sign-in repopulates it.
  const spotifyUserId = profile.data?.spotify_user_id ?? null
  if (spotifyUserId === null) return { status: 'reconnect_required' }

  const listResult = await fetchUserPlaylists(accessToken)
  if (listResult.status === 'auth_failed') {
    return { status: 'reconnect_required' }
  }
  if (listResult.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfterSeconds: listResult.retryAfterSeconds,
    }
  }
  if (listResult.status === 'error') return importFailure(listResult.message)

  const owned: string[] = []
  for (const playlist of listResult.data.values()) {
    if (playlist.ownerId === spotifyUserId) owned.push(playlist.id)
  }
  if (owned.length > SYNC_MAX_PLAYLISTS) {
    return {
      status: 'error',
      message: `Libraries with more than ${SYNC_MAX_PLAYLISTS.toLocaleString()} playlists are not supported yet.`,
    }
  }

  const next: SyncCursor =
    owned.length === 0
      ? { phase: 'albums', offset: 0 }
      : { phase: 'playlists', playlists: owned, index: 0, itemOffset: 0 }
  return {
    status: 'progress',
    syncStartedAt,
    next,
    phase: next.phase,
    phaseCurrent: 0,
    phaseTotal: owned.length === 0 ? null : owned.length,
    batchImported: 0,
  }
}

const runPlaylistsBatch = async (
  context: SyncContext,
  cursor: Extract<SyncCursor, { phase: 'playlists' }>,
): Promise<SyncBatchResponse> => {
  if (cursor.playlists === null) return snapshotOwnedPlaylists(context)
  const { accessToken, syncStartedAt } = context
  const { playlists, index, itemOffset } = cursor
  if (index >= playlists.length) {
    return {
      status: 'progress',
      syncStartedAt,
      next: { phase: 'albums', offset: 0 },
      phase: 'albums',
      phaseCurrent: 0,
      phaseTotal: null,
      batchImported: 0,
    }
  }

  // Any failure other than "this playlist is gone" fails the batch: a retired
  // endpoint's 403 must never read as an empty playlist and prune its songs.
  const playlistId = playlists[index]
  const collected = await collectTrackPages(
    (offset) => fetchPlaylistItemsPage(accessToken, playlistId, offset),
    itemOffset,
    PLAYLIST_ITEMS_PAGE_SIZE,
  )
  if (collected.status !== 'ok') return collected

  const written = await writeSourceTracks(context, [
    {
      sourceType: 'playlist',
      sourceId: playlistId,
      tracks: dedupeMappedTracks(collected.items.map(mapSavedTrack)),
    },
  ])
  if (written.status !== 'ok') return written

  const nextIndex = collected.isLastPage ? index + 1 : index
  const next: SyncCursor =
    nextIndex >= playlists.length
      ? { phase: 'albums', offset: 0 }
      : {
          phase: 'playlists',
          playlists,
          index: nextIndex,
          itemOffset: collected.isLastPage
            ? 0
            : itemOffset + collected.items.length,
        }
  return {
    status: 'progress',
    syncStartedAt,
    next,
    phase: next.phase,
    phaseCurrent: next.phase === 'albums' ? 0 : nextIndex,
    phaseTotal: next.phase === 'albums' ? null : playlists.length,
    batchImported: written.imported,
  }
}

type AlbumTracksCollection =
  { status: 'ok'; tracks: SpotifyTrack[] } | SyncFailure

/**
 * The album's embedded track page plus any continuation pages. Nothing has
 * been written yet when this runs, so a rate limit here surfaces directly and
 * the repeated cursor starts the batch over cleanly.
 */
const collectAlbumTracks = async (
  context: SyncContext,
  album: SpotifySavedAlbum,
): Promise<AlbumTracksCollection> => {
  const tracks = [...album.tracks]
  let offset = album.embeddedTrackCount
  while (offset < album.trackTotal) {
    const result = await fetchAlbumTracksPage(
      context.accessToken,
      album.id,
      offset,
      album.album,
    )
    if (result.status === 'auth_failed') return { status: 'reconnect_required' }
    if (result.status === 'rate_limited') {
      return {
        status: 'rate_limited',
        retryAfterSeconds: result.retryAfterSeconds,
      }
    }
    if (result.status === 'error') return importFailure(result.message)
    if (result.data.items.length === 0) break
    for (const track of result.data.items) {
      if (track !== null) tracks.push(track)
    }
    offset += result.data.items.length
    if (result.data.next === null) break
  }
  return { status: 'ok', tracks }
}

const runAlbumsBatch = async (
  context: SyncContext,
  cursor: Extract<SyncCursor, { phase: 'albums' }>,
): Promise<SyncBatchResponse> => {
  const { accessToken, syncStartedAt } = context
  const pageResult = await fetchSavedAlbumsPage(accessToken, cursor.offset)
  if (pageResult.status === 'auth_failed') {
    return { status: 'reconnect_required' }
  }
  if (pageResult.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfterSeconds: pageResult.retryAfterSeconds,
    }
  }
  if (pageResult.status === 'error') return importFailure(pageResult.message)
  const page = pageResult.data

  const sources: SourceTracks[] = []
  for (const item of page.items) {
    if (item.album === null) continue
    const collected = await collectAlbumTracks(context, item.album)
    if (collected.status !== 'ok') return collected
    // Every track on a saved album was "added" when the album was saved.
    sources.push({
      sourceType: 'album',
      sourceId: item.album.id,
      tracks: dedupeMappedTracks(
        collected.tracks.map((track) => mapAlbumTrack(track, item.added_at)),
      ),
    })
  }

  const written = await writeSourceTracks(context, sources)
  if (written.status !== 'ok') return written

  const nextOffset = cursor.offset + page.items.length
  const isDone =
    page.next === null || page.items.length === 0 || nextOffset >= page.total
  if (!isDone) {
    return {
      status: 'progress',
      syncStartedAt,
      next: { phase: 'albums', offset: nextOffset },
      phase: 'albums',
      phaseCurrent: Math.min(nextOffset, page.total),
      phaseTotal: page.total,
      batchImported: written.imported,
    }
  }
  return finishSync(context, written.imported)
}

/**
 * Drop the source rows this completed pass did not re-see. Liked rows are
 * confirmed against `/me/library/contains` first — that guards offset drift
 * and two tabs syncing at once, as before. Playlist and album membership has
 * no contains-style check, so there the completed full re-read is
 * authoritative; this is also what drops a deleted or unfollowed playlist and
 * an unsaved album. A partial sync never reaches this function.
 */
const reconcileSources = async (
  context: SyncContext,
): Promise<{ status: 'ok' } | SyncFailure> => {
  const { admin, userId, accessToken, syncStartedAt } = context

  const staleSongIds: string[] = []
  for (let from = 0; ; from += STALE_SCAN_PAGE_SIZE) {
    const result = await admin
      .from('user_song_sources')
      .select('song_id')
      .eq('user_id', userId)
      .eq('source_type', 'liked')
      .lt('last_seen_at', syncStartedAt)
      .order('song_id', { ascending: true })
      .range(from, from + STALE_SCAN_PAGE_SIZE - 1)
    if (result.error) return importFailure(result.error.message)
    for (const row of result.data) staleSongIds.push(row.song_id)
    if (result.data.length < STALE_SCAN_PAGE_SIZE) break
  }

  if (staleSongIds.length > 0) {
    // `user_song_sources` deliberately has no direct key to `songs` — a table
    // keyed to both `user_songs` and `songs` reads as a junction to PostgREST
    // and makes every `user_songs → songs` embed ambiguous — so the Spotify
    // ids are looked up in chunks rather than embedded.
    const candidates: { songId: string; spotifyTrackId: string }[] = []
    for (let index = 0; index < staleSongIds.length; index += ID_CHUNK_SIZE) {
      const result = await admin
        .from('songs')
        .select('id, spotify_track_id')
        .in('id', staleSongIds.slice(index, index + ID_CHUNK_SIZE))
      if (result.error) return importFailure(result.error.message)
      for (const row of result.data) {
        candidates.push({
          songId: row.id,
          spotifyTrackId: row.spotify_track_id,
        })
      }
    }

    const statesResult = await fetchSavedTrackStates(
      accessToken,
      candidates.map((candidate) => candidate.spotifyTrackId),
    )
    if (statesResult.status === 'auth_failed') {
      return { status: 'reconnect_required' }
    }
    if (statesResult.status === 'rate_limited') {
      return {
        status: 'rate_limited',
        retryAfterSeconds: statesResult.retryAfterSeconds,
      }
    }
    if (statesResult.status === 'error') {
      return importFailure(statesResult.message)
    }

    const unlikedSongIds = candidates
      .filter(
        (candidate) =>
          statesResult.data.get(candidate.spotifyTrackId) === false,
      )
      .map((candidate) => candidate.songId)
    for (let index = 0; index < unlikedSongIds.length; index += ID_CHUNK_SIZE) {
      const result = await admin
        .from('user_song_sources')
        .delete()
        .eq('user_id', userId)
        .eq('source_type', 'liked')
        .in('song_id', unlikedSongIds.slice(index, index + ID_CHUNK_SIZE))
      if (result.error) return importFailure(result.error.message)
    }
  }

  const stale = await admin
    .from('user_song_sources')
    .delete()
    .eq('user_id', userId)
    .in('source_type', ['playlist', 'album'])
    .lt('last_seen_at', syncStartedAt)
  if (stale.error) return importFailure(stale.error.message)

  return { status: 'ok' }
}

/** Runs only inside the final albums batch: reconcile, prune, and report. */
const finishSync = async (
  context: SyncContext,
  batchImported: number,
): Promise<SyncBatchResponse> => {
  const { admin, userId } = context
  const reconciled = await reconcileSources(context)
  if (reconciled.status !== 'ok') return reconciled

  const pruned = await admin.rpc('prune_user_songs_without_sources', {
    p_user_id: userId,
  })
  if (pruned.error) return importFailure(pruned.error.message)

  const librarySize = await admin
    .from('user_songs')
    .select('song_id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (librarySize.error) return importFailure(librarySize.error.message)

  return {
    status: 'done',
    total: librarySize.count ?? 0,
    importedCount: batchImported,
    removedCount: pruned.data,
  }
}

/**
 * Run one batch of the whole-library sync — Liked Songs, then the playlists
 * the user owns, then saved albums — from `cursor`. The server-issued sync
 * timestamp makes the pass resumable without a database run record; the
 * client echoes both back. All writes go through the service-role client
 * (`songs` is SELECT-only under RLS), each scoped by `userId`.
 */
export const runLibrarySyncBatch = async (
  userId: string,
  cursor: SyncCursor,
  syncStartedAt: string,
): Promise<SyncBatchResponse> => {
  const tokenResult = await getValidSpotifyToken(userId)
  if (tokenResult.status === 'reconnect_required') {
    return { status: 'reconnect_required' }
  }
  if (tokenResult.status === 'error') return importFailure(tokenResult.message)

  const context: SyncContext = {
    admin: createAdminClient(),
    userId,
    accessToken: tokenResult.accessToken,
    syncStartedAt,
  }
  switch (cursor.phase) {
    case 'liked':
      return runLikedBatch(context, cursor)
    case 'playlists':
      return runPlaylistsBatch(context, cursor)
    case 'albums':
      return runAlbumsBatch(context, cursor)
  }
}
