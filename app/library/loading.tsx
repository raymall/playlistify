import { LibraryTableSkeleton } from '@/components/library-table-skeleton'
import { PageSection } from '@/components/page-section'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Instant shell for /library while the page's queries run. Mirrors the
 * returning-user layout (header, import + enrichment panels, search, table) so
 * the real content swaps in without shifting.
 *
 * This fallback only paints because the root layout and SiteHeader read no
 * runtime data of their own — adding cookies()/getUser() to the layout would
 * suppress it (see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/loading.md).
 */
export default function LibraryLoading() {
  return (
    <PageSection>
      <div aria-hidden='true'>
        <header className='flex flex-col gap-1'>
          <Skeleton className='h-9 w-40' />
          <Skeleton className='h-6 w-24' />
        </header>

        <div className='mt-8 flex flex-col gap-4'>
          <Skeleton className='h-9 w-44' />
          <div className='mt-6 flex flex-col gap-4 border-t border-border pt-6'>
            <div className='flex flex-col gap-1.5'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-4 w-full max-w-prose' />
            </div>
            <div className='flex flex-wrap gap-3'>
              <Skeleton className='h-14 w-28' />
              <Skeleton className='h-14 w-28' />
              <Skeleton className='h-14 w-28' />
              <Skeleton className='h-14 w-28' />
              <Skeleton className='h-14 w-28' />
            </div>
            <Skeleton className='h-8 w-44' />
          </div>
        </div>

        <div className='mt-10 flex flex-col gap-6'>
          {/* Taller than the old single-line input: the chips field grows with
              its pills, and a hint line now sits under it. */}
          <div className='flex flex-col gap-1.5'>
            <Skeleton className='h-5 w-40' />
            <div className='flex max-w-2xl items-start gap-2'>
              <Skeleton className='h-10 flex-1' />
              <Skeleton className='h-9 w-20' />
            </div>
            <Skeleton className='h-4 w-72' />
          </div>

          <LibraryTableSkeleton />
        </div>
      </div>

      <span className='sr-only' role='status'>
        Loading your library
      </span>
    </PageSection>
  )
}
