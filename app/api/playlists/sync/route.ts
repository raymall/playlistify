import { jsonResult, requireUser } from '@/lib/api/route-helpers'
import { syncPlaylistStatuses } from '@/lib/playlists/sync'
import { createClient } from '@/lib/supabase/server'

/** Refresh cached Spotify reachability for every playlist owned by the user. */
export async function POST() {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  return jsonResult(await syncPlaylistStatuses(supabase, user.id))
}
