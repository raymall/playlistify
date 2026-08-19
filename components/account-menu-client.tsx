'use client'

import { ChevronDown, UserRoundIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signInWithSpotify } from '@/lib/auth/spotify'
import { cn } from '@/lib/utils'

export function AccountMenuClient({
  displayName,
  needsReconnect,
}: {
  displayName: string
  needsReconnect: boolean
}) {
  async function signOut() {
    await fetch('/auth/signout', { method: 'POST' })
    window.location.assign('/')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${displayName}`}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'w-10 gap-1.5 px-0 text-xs font-medium tracking-[0.14em] uppercase md:w-auto md:px-3',
        )}
      >
        <UserRoundIcon className='size-4 md:hidden' />
        <span className='hidden md:inline'>{displayName}</span>
        <ChevronDown className='hidden size-3 md:block' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {needsReconnect && (
          <>
            <DropdownMenuItem onClick={() => void signInWithSpotify()}>
              Reconnect Spotify
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => void signOut()}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
