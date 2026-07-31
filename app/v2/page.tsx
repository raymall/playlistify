import type { Metadata } from 'next'

import { PlaylistifyMeshLanding } from '@/components/playlistify-mesh-landing'

export const metadata: Metadata = {
  title: 'Veil',
}

export default function VeilLandingPage() {
  return <PlaylistifyMeshLanding mode='veil' />
}
