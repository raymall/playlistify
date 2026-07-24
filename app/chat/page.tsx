import type { Metadata } from 'next'

import { PageSection } from '@/components/page-section'

export const metadata: Metadata = {
  title: 'Chat',
}

export default function ChatPage() {
  return (
    <PageSection>
      <h1 className='text-3xl font-semibold tracking-tight'>Chat</h1>
      <p className='mt-2 text-muted-foreground'>
        Describe the playlist you want; the conversation starts here.
      </p>
    </PageSection>
  )
}
