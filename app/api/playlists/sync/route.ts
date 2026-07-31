import { NextResponse } from 'next/server'

import { requireUser } from '@/lib/api/route-helpers'
import { syncPlaylistStatuses } from '@/lib/playlists/sync'
import { createClient } from '@/lib/supabase/server'

/** Refresh cached Spotify reachability for every playlist owned by the user. */
export async function POST() {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const result = await syncPlaylistStatuses(supabase, user.id)
  return NextResponse.json(result, {
    status: result.status === 'error' ? 500 : 200,
  })
}
