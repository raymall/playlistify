import { type ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * Placeholder block for loading states. `motion-reduce:animate-none` disables
 * the pulse under prefers-reduced-motion — Tailwind's `animate-pulse` does not
 * do this on its own.
 */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted motion-reduce:animate-none',
        className,
      )}
      data-slot='skeleton'
      {...props}
    />
  )
}

export { Skeleton }
