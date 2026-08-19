import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'field-sizing-content min-h-16 w-full rounded-lg border border-control bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-control-ring focus-visible:ring-3 focus-visible:ring-control-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-control-soft/20 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-control-soft/20 dark:disabled:bg-control-soft/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      data-slot='textarea'
      {...props}
    />
  )
}

export { Textarea }
