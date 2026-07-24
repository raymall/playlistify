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
  // user. As on /library we skip getUser() here to avoid a token refresh racing
  // the proxy's.
  const supabase = await createClient()

  const [totalResult, enrichedResult] = await Promise.all([
    supabase
      .from('user_songs')
      .select('song_id', { count: 'exact', head: true }),
    supabase
      .from('user_songs')
      .select('song_id, songs!inner(enrichment_status)', {
        count: 'exact',
        head: true,
      })
      .eq('songs.enrichment_status', 'enriched'),
  ])

  const totalSongs = totalResult.count ?? 0
  const enrichedSongs = enrichedResult.count ?? 0

  return (
    <PageSection>
      <header className='flex flex-col gap-1'>
        <h1 className='text-3xl font-semibold tracking-tight'>Chat</h1>
        <p className='text-muted-foreground'>
          Describe a playlist and I’ll build it from your library.
        </p>
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
      ) : enrichedSongs === 0 ? (
        <div className='mt-8 flex flex-col items-start gap-4'>
          <p className='max-w-prose text-sm text-muted-foreground'>
            None of your {totalSongs.toLocaleString()} songs are enriched yet.
            Enrich them on the Library page so I can match on genre, mood, and
            energy.
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
