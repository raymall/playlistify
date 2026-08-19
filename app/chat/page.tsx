import type { Metadata } from 'next'
import Link from 'next/link'

import { ChatScreen } from '@/components/chat-screen'
import { PageSection } from '@/components/page-section'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Chat',
}

export default async function ChatPage() {
  // Route protection lives in proxy.ts; RLS scopes the counts to the signed-in
  // user. As on /library we skip getUser() here — the proxy owns the refresh.
  const supabase = await createClient()

  const [totalResult, selectableResult] = await Promise.all([
    supabase
      .from('user_songs')
      .select('song_id', { count: 'exact', head: true }),
    supabase.rpc('library_selectable_songs', undefined, {
      count: 'exact',
      head: true,
    }),
  ])

  const totalSongs = totalResult.count ?? 0
  const selectableSongs = selectableResult.count ?? 0

  return (
    <PageSection>
      <header className='border-b-2 border-border pb-8'>
        <div className='flex flex-col gap-4'>
          <p className='editorial-kicker'>02 / Create Playlist</p>
          <h1 className='editorial-title'>Chat</h1>
        </div>
      </header>

      {totalSongs === 0 ? (
        <div className='mt-8 flex flex-col items-start gap-4'>
          <p className='max-w-prose text-sm text-muted-foreground'>
            Import your Spotify Liked Songs first — then I can put playlists
            together from your own music.
          </p>
          <Link className={buttonVariants()} href='/library'>
            Go to your library
          </Link>
        </div>
      ) : selectableSongs === 0 ? (
        <div className='mt-8 flex flex-col items-start gap-4'>
          <p className='max-w-prose text-sm text-muted-foreground'>
            None of your {totalSongs.toLocaleString()} songs are enriched yet.
            Enrich them on the Library page — or tag a few yourself — so I can
            match on genre, mood, and energy.
          </p>
          <Link className={buttonVariants()} href='/library'>
            Enrich your library
          </Link>
        </div>
      ) : (
        <ChatScreen />
      )}
    </PageSection>
  )
}
