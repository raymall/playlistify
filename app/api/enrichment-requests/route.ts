import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { requestEnrichmentRecheck } from '@/lib/enrichment/requests'
import { isRecord, readJson } from '@/lib/json'
import { createClient } from '@/lib/supabase/server'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const readSongId = (value: unknown): string | null => {
  if (!isRecord(value)) return null
  return typeof value.songId === 'string' && UUID_PATTERN.test(value.songId)
    ? value.songId
    : null
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const songId = readSongId(await readJson(request))
  if (songId === null) return errorResponse('Invalid request body', 400)

  const ownership = await supabase
    .from('user_songs')
    .select('song_id')
    .eq('song_id', songId)
    .maybeSingle()
  if (ownership.error !== null) {
    return errorResponse('Could not verify the song', 503, true)
  }
  if (ownership.data === null) {
    return errorResponse('Song is not in your library', 404)
  }

  const result = await requestEnrichmentRecheck(user.id, songId)
  if (result.status === 'error') {
    const isIneligible = result.message.includes('not eligible')
    return errorResponse(
      isIneligible ? 'Song is not eligible for recheck' : result.message,
      isIneligible ? 409 : 500,
    )
  }
  return NextResponse.json({ status: result.result })
}
