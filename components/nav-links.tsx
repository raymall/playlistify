'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

const links = [
  { href: '/library', label: 'Library' },
  { href: '/chat', label: 'Chat' },
  { href: '/playlists', label: 'Playlists' },
] as const

export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav aria-label='Main' className='flex items-center gap-3 sm:gap-6'>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          className={cn(
            'border-b-2 py-1 font-mono text-[0.6875rem] font-medium tracking-[0.12em] uppercase transition-colors',
            pathname.startsWith(href)
              ? 'border-control text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          href={href}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
