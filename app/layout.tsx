import './globals.css'

import type { Metadata, Viewport } from 'next'
import { Archivo, Archivo_Black, IBM_Plex_Mono } from 'next/font/google'
import Image from 'next/image'
import { ThemeProvider } from 'next-themes'

import { SiteHeader } from '@/components/site-header'
import chandlerHuggingMeme from '@/public/chandler-hugging-meme-original-hd-transparent.png'

const archivo = Archivo({
  variable: '--font-archivo-loaded',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const archivoBlack = Archivo_Black({
  variable: '--font-display-loaded',
  subsets: ['latin'],
  weight: '400',
})

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-mono-loaded',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
})

export const metadata: Metadata = {
  title: {
    default: 'Playlistify',
    template: '%s · Playlistify',
  },
  description: "You already found the songs. We'll find the playlist.",
}

export const viewport: Viewport = {
  themeColor: [
    { color: '#f2efe6', media: '(prefers-color-scheme: light)' },
    { color: '#11110f', media: '(prefers-color-scheme: dark)' },
  ],
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      suppressHydrationWarning
      className={`${archivo.variable} ${archivoBlack.variable} ${ibmPlexMono.variable} h-full antialiased`}
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
          <Image
            alt=''
            className='global-chandler-cutout pointer-events-none fixed end-0 bottom-0 z-10 h-auto select-none'
            loading='eager'
            sizes='(max-width: 576px) 9rem, (min-width: 1600px) 25rem, 25vw'
            src={chandlerHuggingMeme}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
