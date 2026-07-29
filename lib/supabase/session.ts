import { type CookieOptions, createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'

import {
  AUTH_STATE_HEADER,
  encodeUserName,
  hasAuthCookie,
  USER_ID_HEADER,
  USER_NAME_HEADER,
  withoutIdentityHeaders,
} from '@/lib/auth/identity'
import { readDisplayName } from '@/lib/auth/metadata'
import { getSupabaseEnv } from '@/lib/supabase/env'
import type { Database } from '@/lib/supabase/types'

/**
 * Refreshes the Supabase session cookie on every matched request, and is the
 * *only* place allowed to: a server component cannot persist a rotated cookie
 * (see lib/supabase/server.ts), so a getUser() in one silently consumes a
 * refresh token. Mounted from the root proxy.ts.
 *
 * The resolved identity rides back to the render on proxy-owned request
 * headers, so the layout doesn't have to ask the auth server a second time.
 */
export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse
  user: User | null
}> {
  const { url, anonKey } = getSupabaseEnv()

  // Collected rather than applied: the response is built once, after getUser(),
  // so it carries the refreshed cookies *and* the identity headers together.
  const pendingCookies: {
    name: string
    value: string
    options: CookieOptions
  }[] = []

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        )
        pendingCookies.push(...cookiesToSet)
      },
    },
  })

  // IMPORTANT: do not run code between client creation and getUser() —
  // a bug there can cause random logouts.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Cloned after the refresh so the forwarded cookie header is the new one.
  const headers = withoutIdentityHeaders(request)
  if (user) {
    headers.set(AUTH_STATE_HEADER, 'user')
    headers.set(USER_ID_HEADER, user.id)
    const displayName = readDisplayName(user.user_metadata)
    if (displayName !== null) {
      headers.set(USER_NAME_HEADER, encodeUserName(displayName))
    }
  } else {
    headers.set(AUTH_STATE_HEADER, hasAuthCookie(request) ? 'blip' : 'none')
  }

  const response = NextResponse.next({ request: { headers } })
  pendingCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  )

  return { response, user }
}
