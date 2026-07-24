import type { Metadata } from 'next'
import Link from 'next/link'

import { PageSection } from '@/components/page-section'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Playlists',
}

const PLAYLISTS_LIMIT = 100

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export default async function PlaylistsPage() {
  // Route protection lives in proxy.ts; RLS scopes every query to the signed-in
  // user. As on /library we deliberately skip getUser() here to avoid a second
  // token refresh racing the proxy's.
  const supabase = await createClient()

  const { data } = await supabase
    .from('playlists')
    .select(
      'id, name, description, prompt, spotify_playlist_id, created_at, playlist_songs(count)',
    )
    .order('created_at', { ascending: false })
    .limit(PLAYLISTS_LIMIT)

  const playlists = data ?? []

  return (
    <PageSection>
      <header className='flex flex-col gap-1'>
        <h1 className='text-3xl font-semibold tracking-tight'>Playlists</h1>
        <p className='text-muted-foreground tabular-nums'>
          {playlists.length.toLocaleString()}{' '}
          {playlists.length === 1 ? 'playlist' : 'playlists'}
        </p>
      </header>

      {playlists.length === 0 ? (
        <div className='mt-8 flex flex-col items-start gap-4'>
          <p className='max-w-prose text-sm text-muted-foreground'>
            You haven’t created any playlists yet. Describe one in chat and it
            will show up here.
          </p>
          <Link className={buttonVariants()} href='/chat'>
            Start a playlist
          </Link>
        </div>
      ) : (
        <ul className='mt-8 flex flex-col gap-3'>
          {playlists.map((playlist) => {
            const name = playlist.name ?? 'Untitled playlist'
            const trackCount = playlist.playlist_songs[0]?.count ?? 0
            const created = dateFormatter.format(new Date(playlist.created_at))
            return (
              <li
                key={playlist.id}
                className='flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'
              >
                <div className='flex min-w-0 flex-col gap-1'>
                  <h2 className='truncate font-medium text-foreground'>
                    {name}
                  </h2>
                  <p className='text-sm text-muted-foreground tabular-nums'>
                    {trackCount.toLocaleString()}{' '}
                    {trackCount === 1 ? 'track' : 'tracks'} · {created}
                  </p>
                  {playlist.prompt !== null && (
                    <p className='max-w-prose truncate text-sm text-muted-foreground'>
                      “{playlist.prompt}”
                    </p>
                  )}
                </div>
                {playlist.spotify_playlist_id !== null && (
                  <a
                    aria-label={`Open “${name}” in Spotify`}
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                    })}
                    href={`https://open.spotify.com/playlist/${playlist.spotify_playlist_id}`}
                    rel='noreferrer'
                    target='_blank'
                  >
                    Open in Spotify
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </PageSection>
  )
}
