import { readDisplayName } from '@/lib/auth/metadata'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSessionDead } from '@/lib/supabase/auth'
import { createClient } from '@/lib/supabase/server'

import { AccountMenuClient } from './account-menu-client'

export async function AccountMenu() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  const user = data.user

  if (!user) {
    // This runs on every page render, so it is the request most likely to
    // collide with the proxy's token refresh. A transient null is not a
    // logout: keep the chrome intact rather than making the whole menu
    // disappear and reappear as the user navigates. Reconnect state is
    // unknowable without a user id, so don't claim one is needed.
    if (!isSessionDead(error)) {
      return <AccountMenuClient displayName='Account' needsReconnect={false} />
    }
    return null
  }

  // spotify_tokens is service-role only; a missing row is the single
  // "reconnect Spotify" signal (rows are deleted on invalid_grant).
  const admin = createAdminClient()
  const { data: tokenRow } = await admin
    .from('spotify_tokens')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const displayName = readDisplayName(user.user_metadata) ?? 'Account'

  return (
    <AccountMenuClient displayName={displayName} needsReconnect={!tokenRow} />
  )
}
