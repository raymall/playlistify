/**
 * Shared PASS/FAIL reporting for the verify scripts. `hard` prints the
 * standard result line and records a failure; `hasFailed` drives each
 * script's own final summary and exit code.
 *
 * @returns {{
 *   hard: (label: string, ok: boolean, detail?: string) => void,
 *   hasFailed: () => boolean,
 * }}
 */
export const createChecker = () => {
  let failureCount = 0
  const hard = (label, ok, detail) => {
    if (!ok) failureCount += 1
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`,
    )
  }
  return { hard, hasFailed: () => failureCount > 0 }
}

/**
 * Head-only count with the error surfaced beside it. Callers must check
 * `error` themselves — a `count` of 0 with a non-null `error` means the
 * query did not run, not that the table is clean.
 *
 * @param {PromiseLike<{ count: number | null, error: unknown }>} query
 */
export const headCount = async (query) => {
  const { count, error } = await query
  return { count: count ?? 0, error }
}
