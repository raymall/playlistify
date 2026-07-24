import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'

import { getSupabaseEnv } from '@/lib/supabase/env'
import type { Database } from '@/lib/supabase/types'

/**
 * Refreshes the Supabase session cookie on every matched request.
 * Mounted from the root proxy.ts; also returns the user so the proxy
 * can apply route-protection redirects.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse
  user: User | null
}> {
  let response = NextResponse.next({ request })

  const { url, anonKey } = getSupabaseEnv()

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        )
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // IMPORTANT: do not run code between client creation and getUser() —
  // a bug there can cause random logouts.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user }
}
