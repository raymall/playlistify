import type { Viewport } from 'next'

import { PlaylistifyMeshLanding } from '@/components/playlistify-mesh-landing'

export const viewport: Viewport = {
  themeColor: '#070905',
  viewportFit: 'cover',
}

export default function LandingPage() {
  return (
    <div className='relative min-h-dvh overflow-x-clip'>
      <PlaylistifyMeshLanding mode='wake' />
    </div>
  )
}
