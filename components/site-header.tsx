import Link from 'next/link'

import { AccountMenu } from '@/components/account-menu'
import { NavLinks } from '@/components/nav-links'
import { ThemeToggle } from '@/components/theme-toggle'

export function SiteHeader() {
  return (
    <header className='site-header border-b'>
      <div className='mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6'>
        <div className='flex items-center gap-8'>
          <Link
            className='text-sm font-bold tracking-[0.14em] uppercase'
            href='/'
          >
            Playlistify
          </Link>
          <NavLinks />
        </div>
        <div className='flex items-center gap-2'>
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
