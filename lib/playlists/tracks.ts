import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'

type MissingTrackPolicy = 'fail' | 'skip'

type ResolveTrackIdsResult =
  | { status: 'ok'; trackIds: string[]; missingCount: number }
  | { status: 'error'; message: string }

/** user_songs id-resolution page size — chunk `.in()` filters to stay safe. */
const OWNERSHIP_CHUNK_SIZE = 100

/**
 * Resolve requested song ids to Spotify track ids in the same order, scoped to
 * the caller's library by RLS. Creation fails on stale ids; recreation skips
 * songs the user no longer owns.
 */
export const resolveTrackIds = async (
  supabase: SupabaseClient<Database>,
  songIds: string[],
  onMissing: MissingTrackPolicy,
): Promise<ResolveTrackIdsResult> => {
  const trackIdBySongId = new Map<string, string>()
  for (let index = 0; index < songIds.length; index += OWNERSHIP_CHUNK_SIZE) {
    const chunk = songIds.slice(index, index + OWNERSHIP_CHUNK_SIZE)
    const result = await supabase
      .from('user_songs')
      .select('song_id, songs!inner(id, spotify_track_id)')
      .in('song_id', chunk)
    if (result.error) {
      return { status: 'error', message: result.error.message }
    }
    for (const row of result.data) {
      trackIdBySongId.set(row.song_id, row.songs.spotify_track_id)
    }
  }

  const trackIds: string[] = []
  let missingCount = 0
  for (const songId of songIds) {
    const trackId = trackIdBySongId.get(songId)
    if (trackId === undefined) {
      missingCount += 1
      if (onMissing === 'fail') {
        return {
          status: 'error',
          message: 'One or more songs are no longer in your library.',
        }
      }
      continue
    }
    trackIds.push(trackId)
  }
  return { status: 'ok', trackIds, missingCount }
}
