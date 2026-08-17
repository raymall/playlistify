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

/** String entries of `value`; a non-array yields [] and non-strings are skipped. */
export const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const str = readString(entry)
    if (str !== null) out.push(str)
  }
  return out
}

/** Request or Response body as unknown, or null when it isn't valid JSON. */
export const readJson = async (
  source: Request | Response,
): Promise<unknown> => {
  try {
    return await source.json()
  } catch {
    return null
  }
}
