import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { MIN_TAG_QUERY_LENGTH } from '@/lib/library/search-params'
import { createClient } from '@/lib/supabase/server'
import { normalizeTagName } from '@/lib/vocabulary'

/** Rows offered per keystroke. */
const SUGGESTION_LIMIT = 10

/** Head counts stop here and render as "200+". */
const COUNT_CAP = 200

/**
 * Filter-pill typeahead for /library, also used by the per-song tag editor.
 *
 * A route handler rather than a direct browser `supabase.rpc` because this is a
 * per-keystroke path: the limits below are enforced server-side so a crafted
 * request cannot ask for ten thousand rows, and it is the only place a cache
 * header or rate limit could ever live. The extra hop disappears behind the
 * client's 250 ms debounce.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const { searchParams } = new URL(request.url)
  const query = normalizeTagName(searchParams.get('q') ?? '')
  if (query.length < MIN_TAG_QUERY_LENGTH) {
    return NextResponse.json({ status: 'ok', suggestions: [] })
  }

  const result = await supabase.rpc('library_tag_suggestions', {
    p_query: query,
    p_limit: SUGGESTION_LIMIT,
    p_count_cap: COUNT_CAP,
  })
  if (result.error !== null) {
    console.error('[tag-suggestions] lookup failed:', result.error.message)
    return errorResponse('Could not load tag suggestions', 503, true)
  }

  return NextResponse.json({
    status: 'ok',
    suggestions: result.data.flatMap((row) =>
      row.kind === 'genre' || row.kind === 'mood'
        ? [
            {
              kind: row.kind,
              name: row.name,
              songCount: row.song_count,
              isCapped: row.is_capped,
            },
          ]
        : [],
    ),
  })
}
