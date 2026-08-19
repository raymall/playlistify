import { NextResponse } from 'next/server'

import { readDisplayName } from '@/lib/auth/metadata'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth callback. Exchanges the PKCE code for a session and immediately
 * captures the Spotify provider tokens: Supabase does NOT refresh provider
 * tokens and only reliably exposes provider_refresh_token right here.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const { session, user } = data
      const admin = createAdminClient()

      const spotifyIdentity = user.identities?.find(
        (identity) => identity.provider === 'spotify',
      )

      // user_metadata values are provider-controlled and untyped — narrow, don't trust.
      const metadata: Record<string, unknown> = user.user_metadata

      // profiles row first: spotify_tokens has an FK to it.
      await admin.from('profiles').upsert({
        id: user.id,
        spotify_user_id:
          spotifyIdentity?.id ??
          (typeof metadata.provider_id === 'string'
            ? metadata.provider_id
            : null),
        display_name: readDisplayName(metadata),
      })

      const providerToken = session.provider_token
      const providerRefreshToken = session.provider_refresh_token

      if (providerToken) {
        const tokenFields = {
          access_token: providerToken,
          // Supabase doesn't expose the provider token's expiry; Spotify
          // access tokens last 60 min — store a conservative 55.
          expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }
        if (providerRefreshToken) {
          await admin.from('spotify_tokens').upsert({
            user_id: user.id,
            refresh_token: providerRefreshToken,
            ...tokenFields,
          })
        } else {
          // Refresh token absent on this exchange: update the access token,
          // keep any previously captured refresh token.
          await admin
            .from('spotify_tokens')
            .update(tokenFields)
            .eq('user_id', user.id)
        }
      }

      return NextResponse.redirect(`${origin}/library`)
    }
  }

  return NextResponse.redirect(`${origin}/?auth_error=1`)
}
