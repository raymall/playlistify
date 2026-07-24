/**
 * Shared JSON narrowing guards. Pure TypeScript with no server, React, or
 * browser dependency — importable from route handlers, server libs, and
 * 'use client' components alike.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const readString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

export const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** Request body as unknown, or null when the body isn't valid JSON. */
export const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return null
  }
}
