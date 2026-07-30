/**
 * Reads get a single retry because postgrest-js already retries idempotent
 * requests internally (3x, 1s/2s/4s backoff) and the layers multiply; writes
 * and auth calls are retried nowhere else, so they get the full ladder.
 */
const READ_RETRY_DELAYS_MS = [1000]
const WRITE_RETRY_DELAYS_MS = [1000, 2000, 4000]

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const readNetworkErrorCode = (error: unknown): string | null => {
  if (!(error instanceof Error)) return null
  const { cause } = error
  if (
    typeof cause !== 'object' ||
    cause === null ||
    !('code' in cause) ||
    typeof cause.code !== 'string'
  ) {
    return null
  }
  return cause.code
}

/**
 * Server-side fetch that retries network-level failures. undici surfaces dead
 * keep-alive sockets, sleep-wake transitions, and DNS blips as a rejected
 * fetch (`TypeError: fetch failed`); retrying opens a fresh connection, which
 * is usually all it takes. HTTP error responses resolve normally and are never
 * retried here, and aborts rethrow immediately. Mutating callers must make
 * replay safe; enrichment claims do that with a caller-issued lease token.
 */
export const fetchWithRetries: typeof fetch = async (input, init) => {
  const method = init?.method?.toUpperCase() ?? 'GET'
  const delays =
    method === 'GET' || method === 'HEAD'
      ? READ_RETRY_DELAYS_MS
      : WRITE_RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(input, init)
    } catch (error) {
      const isAborted =
        init?.signal?.aborted === true ||
        (error instanceof Error && error.name === 'AbortError')
      if (isAborted) throw error
      const errorCode = readNetworkErrorCode(error)
      const context = `${method}${errorCode === null ? '' : ` ${errorCode}`}`
      if (attempt >= delays.length) {
        console.error(
          `[supabase] network failure after ${attempt + 1} attempts (${context}):`,
          error,
        )
        throw error
      }
      const delay = delays[attempt]
      console.warn(
        `[supabase] transient network failure; retry ${attempt + 1}/${delays.length} in ${delay}ms (${context})`,
      )
      await sleep(delay)
    }
  }
}
