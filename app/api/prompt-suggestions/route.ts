import { NextResponse } from 'next/server'

import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import { generatePromptSuggestions } from '@/lib/chat/suggestions'
import { createClient } from '@/lib/supabase/server'

/** Return one session's library-grounded playlist prompt ideas. */
export async function GET() {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  try {
    const result = await generatePromptSuggestions(supabase)
    if (result.status === 'error') {
      return errorResponse(result.message, 503, true)
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('[prompt-suggestions] library summary failed:', error)
    return errorResponse('Could not read your library', 500)
  }
}
