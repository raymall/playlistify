import { type NextRequest, NextResponse } from 'next/server'

import { updateSession } from '@/lib/supabase/session'

const PROTECTED_PREFIXES = ['/library', '/chat', '/playlists']

/** Redirect while preserving any refreshed session cookies. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  return redirect
}

/**
 * A prefetch is speculative — the user hasn't navigated. Refreshing the session
 * (getUser rotates the Supabase token) on prefetches piles concurrent refreshes
 * onto the real navigation and momentarily invalidates the session cookie;
 * redirecting them poisons the client router cache with a wrong destination.
 */
function isPrefetch(request: NextRequest) {
  return (
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch' ||
    (request.headers.get('sec-purpose')?.includes('prefetch') ?? false)
  )
}

/**
 * True when the request carries a Supabase auth cookie (`sb-<ref>-auth-token`,
 * possibly chunked `.0`/`.1`). A null getUser() *with* this cookie present is
 * the refresh/chunked-cookie race, not a real logout — a signed-out user has no
 * such cookie at all.
 */
function hasAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name))
}

/**
 * Runs on every matched request (Next's middleware equivalent): refreshes
 * the Supabase session cookie, bounces signed-out users off protected pages,
 * and lands signed-in users on /chat instead of /. `/api/*` is matched (so
 * sessions refresh) but never redirected — API routes gate on getUser().
 */
export async function proxy(request: NextRequest) {
  // Never refresh tokens or redirect on prefetches — see isPrefetch above.
  if (isPrefetch(request)) {
    return NextResponse.next({ request })
  }

  const { response, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  if (
    !user &&
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    // Transient getUser() blip on a live session: let the navigation through
    // instead of bouncing '/library' -> '/' -> '/chat'. Only a genuine logout
    // (no auth cookie) redirects to the marketing page.
    if (hasAuthCookie(request)) {
      return response
    }
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return redirectWithCookies(url, response)
  }

  // Signed-in users land on /chat, not the marketing page.
  if (user && pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/chat'
    return redirectWithCookies(url, response)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
