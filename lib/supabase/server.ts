import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { getSupabaseEnv } from '@/lib/supabase/env'
import { fetchWithRetries } from '@/lib/supabase/fetch'
import type { Database } from '@/lib/supabase/types'

/**
 * Request-scoped Supabase client for server components and route handlers:
 * anon key + the caller's session cookie, so RLS runs as the signed-in user.
 */
export async function createClient() {
  const cookieStore = await cookies()
  const { url, anonKey } = getSupabaseEnv()

  return createServerClient<Database>(url, anonKey, {
    global: { fetch: fetchWithRetries },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore when session refresh happens in the proxy.
        }
      },
    },
  })
}
