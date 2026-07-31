'use client'

import { Button } from '@/components/ui/button'
import { signInWithSpotify } from '@/lib/auth/spotify'

type SpotifySignInButtonProps = {
  className?: string
}

export const SpotifySignInButton = ({
  className,
}: SpotifySignInButtonProps) => {
  const handleSignIn = () => {
    void signInWithSpotify()
  }

  return (
    <Button className={className} size='lg' onClick={handleSignIn}>
      Continue with Spotify
    </Button>
  )
}
