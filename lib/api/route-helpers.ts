import { NextResponse } from 'next/server'

/**
 * Standard error body for the JSON API routes. Server-only (imports
 * next/server) — never import from a client component. `safeToRetry` is
 * omitted entirely when unset: the enrichment client treats an absent field
 * as ambiguous and an explicit `false` as a billed failure, so always
 * spreading it would change client behavior.
 */
export const errorResponse = (
  message: string,
  status: number,
  safeToRetry?: boolean,
) =>
  NextResponse.json(
    safeToRetry === undefined
      ? { status: 'error', message }
      : { status: 'error', message, safeToRetry },
    { status },
  )
