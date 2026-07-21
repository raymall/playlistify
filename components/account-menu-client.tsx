'use client'

import { ChevronDown } from 'lucide-react'

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
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'text-xs font-medium tracking-[0.14em] uppercase',
        )}
      >
        {displayName}
        <ChevronDown className='size-3' />
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
