import { headers } from 'next/headers'

import {
  AUTH_STATE_HEADER,
  decodeUserName,
  readAuthState,
  USER_ID_HEADER,
  USER_NAME_HEADER,
} from '@/lib/auth/identity'
import { readDisplayName } from '@/lib/auth/metadata'
import { createAdminClient } from '@/lib/supabase/admin'
import { classifyNullUser } from '@/lib/supabase/auth'
import { createClient } from '@/lib/supabase/server'

import { AccountMenuClient } from './account-menu-client'

/** The "reconnect Spotify" signal: spotify_tokens is service-role only, and a
 * missing row is the whole test (rows are deleted on invalid_grant). */
async function needsSpotifyReconnect(userId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('spotify_tokens')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return !data
}

/**
 * Renders in the root layout, so it runs on every page render — which is why
 * it must not call getUser(). The proxy already resolved the caller and
 * forwards the answer on `x-auth-state`; asking again would be a second auth
 * round-trip per page, and a server component cannot persist a cookie, so any
 * token it rotated would be silently consumed and thrown away.
 */
export async function AccountMenu() {
  const headerList = await headers()
  const state = headerList.get(AUTH_STATE_HEADER)

  if (state === null) {
    // The proxy didn't run (its matcher excludes static assets). Nothing has
    // resolved the session, so fall back to asking — not a race, because
    // there is no first refresh for this one to collide with.
    return <AccountMenuFallback />
  }

  switch (readAuthState(state)) {
    case 'user': {
      const userId = headerList.get(USER_ID_HEADER)
      if (userId === null) return null
      const displayName = decodeUserName(headerList.get(USER_NAME_HEADER))
      return (
        <AccountMenuClient
          displayName={displayName ?? 'Account'}
          needsReconnect={await needsSpotifyReconnect(userId)}
        />
      )
    }
    case 'blip':
      // A transient null is not a logout: keep the chrome intact rather than
      // making the menu vanish and reappear as the user navigates. Reconnect
      // state is unknowable without a user id, so don't claim one is needed.
      return <AccountMenuClient displayName='Account' needsReconnect={false} />
    case 'none':
      return null
  }
}

async function AccountMenuFallback() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  const user = data.user

  if (!user) {
    if (!classifyNullUser('AccountMenu', error)) {
      return <AccountMenuClient displayName='Account' needsReconnect={false} />
    }
    return null
  }

  return (
    <AccountMenuClient
      displayName={readDisplayName(user.user_metadata) ?? 'Account'}
      needsReconnect={await needsSpotifyReconnect(user.id)}
    />
  )
}
