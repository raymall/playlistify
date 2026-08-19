import Link from 'next/link'

import { AccountMenu } from '@/components/account-menu'
import { NavLinks } from '@/components/nav-links'
import { ThemeToggle } from '@/components/theme-toggle'

export function SiteHeader() {
  return (
    <header className='site-header border-b border-border'>
      <div className='mx-auto flex h-16 w-full max-w-[100rem] items-center justify-between px-4 sm:px-6 lg:px-10'>
        <div className='flex items-center gap-8'>
          <Link
            className='hidden font-display text-lg leading-none tracking-[-0.035em] uppercase sm:block'
            href='/'
          >
            Playlistify
          </Link>
          <NavLinks />
        </div>
        <div className='flex items-center gap-1 sm:gap-2'>
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
