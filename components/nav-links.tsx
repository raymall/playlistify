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
    <nav aria-label='Main' className='flex items-center gap-6'>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          className={cn(
            'text-xs font-medium tracking-[0.14em] uppercase transition-colors',
            pathname.startsWith(href)
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          href={href}
        >
          {label}
        </Link>
      ))}
    </nav>
  )
}
