import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

/**
 * Clears the Supabase session and redirects to the landing page. Posted by
 * the account menu (components/account-menu-client.tsx).
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/', request.url), { status: 302 })
}
