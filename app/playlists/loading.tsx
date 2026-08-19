import { PageSection } from '@/components/page-section'
import { Skeleton } from '@/components/ui/skeleton'

/** Loading shell aligned to the final editorial layout to avoid route shifts. */
export default function PlaylistsLoading() {
  return (
    <PageSection>
      <div aria-hidden='true'>
        <header className='flex flex-col gap-5 border-b-2 border-border pb-8 sm:flex-row sm:items-end sm:justify-between'>
          <div className='flex flex-col gap-4'>
            <p className='editorial-kicker'>03 / Made by Playlistify for you</p>
            <h1 className='editorial-title'>Playlists</h1>
          </div>
          <div className='grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto'>
            <Skeleton className='h-10 w-full sm:w-36' />
            <Skeleton className='h-10 w-full sm:w-44' />
          </div>
        </header>

        <article className='mt-10 grid border-2 border-border lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]'>
          <Skeleton className='aspect-square min-h-80 w-full' />
          <div className='flex min-w-0 flex-col justify-between gap-8 border-t-2 border-border p-5 sm:p-8 lg:border-t-0 lg:border-l-2'>
            <div className='flex flex-col gap-5'>
              <div className='flex items-center justify-between gap-3'>
                <Skeleton className='h-3 w-32' />
                <Skeleton className='h-6 w-24' />
              </div>
              <Skeleton className='h-14 w-4/5' />
              <Skeleton className='h-3 w-40' />
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-4 w-full' />
                <Skeleton className='h-4 w-3/4' />
              </div>
            </div>
            <div className='grid gap-2'>
              <Skeleton className='h-12 w-full' />
              <Skeleton className='h-12 w-full' />
            </div>
          </div>
        </article>
      </div>

      <span className='sr-only' role='status'>
        Loading your playlists
      </span>
    </PageSection>
  )
}
