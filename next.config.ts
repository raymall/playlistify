import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    // Spotify serves all album art from this host; the stored URL is the
    // 640px cover, which next/image downscales to the ~40px table thumbnail.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co', pathname: '/image/**' },
    ],
  },
}

export default nextConfig
