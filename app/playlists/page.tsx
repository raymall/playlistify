import type { Metadata } from 'next'

import { PageSection } from '@/components/page-section'

export const metadata: Metadata = {
  title: 'Playlists',
}

export default function PlaylistsPage() {
  return (
    <PageSection>
      <h1 className='text-3xl font-semibold tracking-tight'>Playlists</h1>
      <p className='mt-2 text-muted-foreground'>
        Playlists you create through the app will be listed here.
      </p>
    </PageSection>
  )
}
