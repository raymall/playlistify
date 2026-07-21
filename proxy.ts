import { type NextRequest, NextResponse } from 'next/server'

import { updateSession } from '@/lib/supabase/session'

const PROTECTED_PREFIXES = ['/library', '/chat', '/playlists']

/** Redirect while preserving any refreshed session cookies. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  return redirect
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  if (
    !user &&
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
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
