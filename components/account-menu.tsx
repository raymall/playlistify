import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

import { AccountMenuClient } from './account-menu-client'

export async function AccountMenu() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // spotify_tokens is service-role only; a missing row is the single
  // "reconnect Spotify" signal (rows are deleted on invalid_grant).
  const admin = createAdminClient()
  const { data: tokenRow } = await admin
    .from('spotify_tokens')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  // user_metadata values are provider-controlled and untyped — narrow, don't trust.
  const metadata: Record<string, unknown> = user.user_metadata
  const displayName =
    typeof metadata.full_name === 'string'
      ? metadata.full_name
      : typeof metadata.name === 'string'
        ? metadata.name
        : 'Account'

  return (
    <AccountMenuClient displayName={displayName} needsReconnect={!tokenRow} />
  )
}
