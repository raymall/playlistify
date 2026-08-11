import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import { buildPaginationSlots } from '@/lib/library/pagination'
import {
  buildLibraryHref,
  type LibrarySearchState,
  withLibraryPage,
} from '@/lib/library/search-params'
import { cn } from '@/lib/utils'

type LibraryPaginationProps = {
  page: number
  pageCount: number
  state: LibrarySearchState
}

/**
 * A server component of plain links, so prefetch, back/forward, and
 * middle-click all work with no client JavaScript. `aria-current` carries the
 * current page, so it is never signalled by colour alone.
 */
export const LibraryPagination = ({
  page,
  pageCount,
  state,
}: LibraryPaginationProps) => {
  if (pageCount <= 1) return null

  const slotClass = buttonVariants({ size: 'sm', variant: 'outline' })
  const numberClass = cn(slotClass, 'min-w-8')
  const currentClass = cn(
    buttonVariants({ size: 'sm', variant: 'default' }),
    'min-w-8',
  )
  const disabledClass = cn(slotClass, 'pointer-events-none opacity-50')
  const hrefFor = (target: number) =>
    buildLibraryHref(withLibraryPage(state, target))

  return (
    <nav
      aria-label='Library pagination'
      className='mt-4 flex flex-col items-center gap-2'
    >
      <div className='flex flex-wrap items-center justify-center gap-1'>
        {page > 1 ? (
          <Link className={slotClass} href={hrefFor(1)}>
            First
          </Link>
        ) : (
          <span aria-disabled='true' className={disabledClass}>
            First
          </span>
        )}
        {page > 1 ? (
          <Link className={slotClass} href={hrefFor(page - 1)}>
            Previous
          </Link>
        ) : (
          <span aria-disabled='true' className={disabledClass}>
            Previous
          </span>
        )}

        {buildPaginationSlots(page, pageCount).map((slot) =>
          slot.kind === 'gap' ? (
            <span
              key={`gap-${slot.key}`}
              aria-hidden='true'
              className='px-1 text-sm text-muted-foreground'
            >
              …
            </span>
          ) : (
            <Link
              key={slot.page}
              aria-current={slot.page === page ? 'page' : undefined}
              className={slot.page === page ? currentClass : numberClass}
              href={hrefFor(slot.page)}
            >
              {slot.page}
            </Link>
          ),
        )}

        {page < pageCount ? (
          <Link className={slotClass} href={hrefFor(page + 1)}>
            Next
          </Link>
        ) : (
          <span aria-disabled='true' className={disabledClass}>
            Next
          </span>
        )}
        {page < pageCount ? (
          <Link className={slotClass} href={hrefFor(pageCount)}>
            Last
          </Link>
        ) : (
          <span aria-disabled='true' className={disabledClass}>
            Last
          </span>
        )}
      </div>
      <span className='text-sm text-muted-foreground tabular-nums'>
        Page {page} of {pageCount}
      </span>
    </nav>
  )
}
