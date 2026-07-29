import type { NextRequest } from 'next/server'

/**
 * What the proxy resolved about the caller, forwarded to the render so no
 * server component has to ask again:
 *
 * - `user` — a live session; `x-user-id` and `x-user-name` accompany it.
 * - `blip` — `getUser()` returned null but the request still carries an `sb-*`
 *   cookie. A rotation or network blip, not a logout.
 * - `none` — no session cookie at all: genuinely signed out.
 */
export type AuthState = 'user' | 'blip' | 'none'

export const AUTH_STATE_HEADER = 'x-auth-state'
export const USER_ID_HEADER = 'x-user-id'
export const USER_NAME_HEADER = 'x-user-name'

const IDENTITY_HEADERS = [
  AUTH_STATE_HEADER,
  USER_ID_HEADER,
  USER_NAME_HEADER,
] as const

/**
 * Request headers with every identity header removed. These are proxy-owned
 * and a client can send them too, so *every* path through the proxy has to
 * drop the inbound copy — otherwise a forged `x-user-id` reaches the render as
 * if the proxy had vouched for it.
 */
export const withoutIdentityHeaders = (request: NextRequest) => {
  const headers = new Headers(request.headers)
  IDENTITY_HEADERS.forEach((name) => {
    headers.delete(name)
  })
  return headers
}

/**
 * True when the request carries a Supabase auth cookie (`sb-<ref>-auth-token`,
 * possibly chunked `.0`/`.1`). A null getUser() *with* this cookie present is
 * the refresh/chunked-cookie race, not a real logout — a signed-out user has no
 * such cookie at all.
 */
export const hasAuthCookie = (request: NextRequest) =>
  request.cookies
    .getAll()
    .some((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name))

/**
 * Header values have to survive a latin-1 hop, and a display name is
 * provider-controlled free text — encode it rather than hoping it is ASCII.
 */
export const encodeUserName = (name: string) => encodeURIComponent(name)

export const decodeUserName = (value: string | null) => {
  if (value === null) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** Narrow the forwarded header; anything unrecognised is treated as no session. */
export const readAuthState = (value: string | null): AuthState =>
  value === 'user' || value === 'blip' ? value : 'none'
