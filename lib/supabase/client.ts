import { createBrowserClient } from '@supabase/ssr'

import { getSupabaseEnv } from '@/lib/supabase/env'
import type { Database } from '@/lib/supabase/types'

/**
 * Browser Supabase client (anon key — RLS enforced) for client components.
 * Server code uses server.ts (RLS as the user) or admin.ts (service role).
 */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv()

  return createBrowserClient<Database>(url, anonKey)
}
