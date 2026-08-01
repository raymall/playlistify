import { PageSection } from '@/components/page-section'
import { Skeleton } from '@/components/ui/skeleton'

const PLACEHOLDER_CARDS = ['a', 'b', 'c']

/** Instant shell for the managed-playlists card layout. */
export default function PlaylistsLoading() {
  return (
    <PageSection>
      <div aria-hidden='true'>
        <header className='flex items-start justify-between gap-4'>
          <div className='flex flex-col gap-1'>
            <Skeleton className='h-9 w-40' />
            <Skeleton className='h-6 w-24' />
          </div>
          <Skeleton className='h-8 w-28' />
        </header>

        <div className='mt-6 flex items-center justify-between gap-4 border-t pt-4'>
          <Skeleton className='h-4 w-56' />
          <Skeleton className='h-7 w-28' />
        </div>

        <div className='mt-8 grid gap-4'>
          {PLACEHOLDER_CARDS.map((key) => (
            <div
              key={key}
              className='flex flex-col gap-5 rounded-lg border p-4 sm:p-5'
            >
              <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
                <div className='flex flex-1 gap-4'>
                  <Skeleton className='size-24 shrink-0 sm:size-28' />
                  <div className='flex flex-1 flex-col gap-2'>
                    <div className='flex items-center gap-2'>
                      <Skeleton className='h-5 w-48' />
                      <Skeleton className='h-5 w-24 rounded-4xl' />
                    </div>
                    <Skeleton className='h-4 w-64 max-w-full' />
                    <Skeleton className='h-4 w-full max-w-xl' />
                  </div>
                </div>
                <div className='flex gap-2'>
                  <Skeleton className='h-7 w-14' />
                  <Skeleton className='h-7 w-20' />
                  <Skeleton className='h-7 w-16' />
                </div>
              </div>

              <div className='flex flex-col gap-2 border-t pt-4'>
                <Skeleton className='h-3 w-28' />
                <div className='flex flex-wrap gap-1'>
                  <Skeleton className='h-5 w-16 rounded-4xl' />
                  <Skeleton className='h-5 w-20 rounded-4xl' />
                  <Skeleton className='h-5 w-14 rounded-4xl' />
                  <Skeleton className='h-5 w-24 rounded-4xl' />
                </div>
              </div>

              <Skeleton className='h-7 w-28' />
            </div>
          ))}
        </div>
      </div>

      <span className='sr-only' role='status'>
        Loading your playlists
      </span>
    </PageSection>
  )
}
