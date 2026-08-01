import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    // Spotify album art and generated playlist mosaics are served from these
    // hosts. next/image resizes the original square without cropping it.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co', pathname: '/image/**' },
      { protocol: 'https', hostname: 'mosaic.scdn.co', pathname: '/**' },
    ],
  },
}

export default nextConfig
