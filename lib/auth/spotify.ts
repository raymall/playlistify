import { createClient } from '@/lib/supabase/client'

export const SPOTIFY_SCOPES =
  'user-library-read playlist-modify-public playlist-modify-private'

/**
 * Starts the Spotify OAuth flow (browser only). Also used to re-connect
 * when the stored refresh token has been invalidated — a fresh sign-in
 * re-captures provider tokens in the auth callback.
 */
export async function signInWithSpotify() {
  const supabase = createClient()
  await supabase.auth.signInWithOAuth({
    provider: 'spotify',
    options: {
      scopes: SPOTIFY_SCOPES,
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
}
