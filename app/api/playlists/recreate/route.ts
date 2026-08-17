import { errorResponse, jsonResult, requireUser } from '@/lib/api/route-helpers'
import { readJson } from '@/lib/json'
import { recreatePlaylistForUser } from '@/lib/playlists/recreate'
import { readPlaylistIdPayload } from '@/lib/playlists/validation'
import { createClient } from '@/lib/supabase/server'

/** Rebuild a missing Spotify playlist from its stored ordered song snapshot. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const payload = readPlaylistIdPayload(await readJson(request))
  if (payload === null) return errorResponse('Invalid request body', 400)

  return jsonResult(
    await recreatePlaylistForUser(supabase, user.id, payload.playlistId),
  )
}
