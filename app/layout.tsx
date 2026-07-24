import './globals.css'

import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { ThemeProvider } from 'next-themes'

import { SiteHeader } from '@/components/site-header'

const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'Playlistify',
    template: '%s · Playlistify',
  },
  description:
    'Turn your Spotify library into AI-built playlists you describe in plain language.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      suppressHydrationWarning
      className={`${geistSans.variable} h-full antialiased`}
      lang='en'
    >
      <body className='flex min-h-full flex-col'>
        <ThemeProvider
          disableTransitionOnChange
          enableSystem
          attribute='class'
          defaultTheme='system'
        >
          <SiteHeader />
          <main className='flex-1'>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  )
}
