import type { Metadata, Viewport } from 'next'

import { PlaylistifyMeshLanding } from '@/components/playlistify-mesh-landing'

export const metadata: Metadata = {
  title: 'Veil',
}

export const viewport: Viewport = {
  themeColor: '#070905',
  viewportFit: 'cover',
}

export default function VeilLandingPage() {
  return <PlaylistifyMeshLanding mode='veil' />
}
