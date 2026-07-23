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

/**
 * Server-side fetch that retries network-level failures. undici surfaces dead
 * keep-alive sockets, sleep-wake transitions, and DNS blips as a rejected
 * fetch (`TypeError: fetch failed`); retrying opens a fresh connection, which
 * is usually all it takes. HTTP error responses resolve normally and are never
 * retried here, and aborts rethrow immediately. Safe to re-send: supabase-js
 * passes string bodies, and every write in this app is idempotent.
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
      if (isAborted || attempt >= delays.length) throw error
      console.error(
        `[supabase] network failure, retrying (attempt ${attempt + 1}):`,
        error,
      )
      await sleep(delays[attempt])
    }
  }
}
