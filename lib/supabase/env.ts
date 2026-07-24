/**
 * Shared guard for the public Supabase connection env. The literal
 * `process.env.NEXT_PUBLIC_*` accesses are what Next.js inlines at build
 * time, so this works identically in server and browser bundles. The admin
 * client checks its own service-role key and stays separate.
 */
export const getSupabaseEnv = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
    )
  }
  return { url, anonKey }
}
