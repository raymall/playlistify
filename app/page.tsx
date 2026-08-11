import Image from 'next/image'

import { PlaylistifyMeshLanding } from '@/components/playlistify-mesh-landing'
import chandlerHuggingMeme from '@/public/chandler-hugging-meme-original-hd-transparent.png'

export default function LandingPage() {
  return (
    <div className='relative min-h-svh overflow-hidden'>
      <PlaylistifyMeshLanding mode='wake' />
      <Image
        alt=''
        className='pointer-events-none absolute right-0 bottom-0 z-10 h-auto w-36 select-none sm:w-48 md:w-56 lg:w-100'
        loading='eager'
        sizes='(min-width: 1024px) 16rem, (min-width: 768px) 14rem, (min-width: 640px) 12rem, 9rem'
        src={chandlerHuggingMeme}
      />
    </div>
  )
}
