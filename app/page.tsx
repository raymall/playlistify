import { SpotifySignInButton } from '@/components/spotify-sign-in-button'

export default function LandingPage() {
  return (
    <section className='mx-auto w-full max-w-6xl px-4 sm:px-6'>
      <div className='grid min-h-[70svh] grid-cols-1 content-center py-24 md:grid-cols-12'>
        <div className='md:col-span-10'>
          <h1 className='text-5xl font-semibold tracking-tighter text-balance sm:text-7xl'>
            Your Spotify library, arranged by a sentence.
          </h1>
          <p className='mt-6 max-w-xl text-lg text-muted-foreground'>
            Playlistify imports your Liked Songs, learns what each track feels
            like, and turns a plain-language request into a real playlist in
            your Spotify account.
          </p>
          <div className='mt-10'>
            <SpotifySignInButton />
          </div>
        </div>
      </div>
    </section>
  )
}
