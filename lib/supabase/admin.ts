import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { fetchWithRetries } from '@/lib/supabase/fetch'
import type { Database } from '@/lib/supabase/types'

/**
 * Service-role client. Bypasses RLS — server-side code only, never import
 * from a client component. `SUPABASE_SERVICE_ROLE_KEY` is not NEXT_PUBLIC_,
 * so it never reaches the browser bundle.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: fetchWithRetries },
  })
}
