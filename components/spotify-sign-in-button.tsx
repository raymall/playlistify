'use client'

import { Button } from '@/components/ui/button'
import { signInWithSpotify } from '@/lib/auth/spotify'

export function SpotifySignInButton() {
  return (
    <Button size='lg' onClick={() => void signInWithSpotify()}>
      Continue with Spotify
    </Button>
  )
}
