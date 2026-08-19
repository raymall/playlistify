'use client'

import { XIcon } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState } from 'react'

import { LibraryConfidenceInfo } from '@/components/library-confidence-info'
import { LibraryTagEditor } from '@/components/library-tag-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CONFIDENCE_BANDS,
  type ConfidenceBand,
  getConfidenceBand,
} from '@/lib/enrichment/confidence'
import { type LibrarySong } from '@/lib/library/song'
import { cn } from '@/lib/utils'

type LibraryTableProps = {
  activeBands: ConfidenceBand[]
  activeGenres: string[]
  activeMoods: string[]
  songs: LibrarySong[]
}

const confidenceVariant: Record<
  ConfidenceBand,
  'default' | 'secondary' | 'outline' | 'ghost'
> = {
  pending: 'ghost',
  none: 'outline',
  low: 'outline',
  medium: 'secondary',
  high: 'default',
}

type LibraryTagListProps = {
  activeGenres: Set<string>
  activeMoods: Set<string>
  song: LibrarySong
}

const LibraryTagList = ({
  activeGenres,
  activeMoods,
  song,
}: LibraryTagListProps) => {
  const hiddenGenreIds = new Set(song.hiddenGenres.map((tag) => tag.id))
  const hiddenMoodIds = new Set(song.hiddenMoods.map((tag) => tag.id))
  const aiGenres = song.aiGenres.filter((tag) => !hiddenGenreIds.has(tag.id))
  const aiMoods = song.aiMoods.filter((tag) => !hiddenMoodIds.has(tag.id))
  const tags = [
    ...aiGenres.map((tag) => ({
      ...tag,
      key: `ai-genre-${tag.id}`,
      source: 'AI genre',
      isActive: activeGenres.has(tag.name),
    })),
    ...aiMoods.map((tag) => ({
      ...tag,
      key: `ai-mood-${tag.id}`,
      source: 'AI mood',
      isActive: activeMoods.has(tag.name),
    })),
    ...song.userGenres.map((tag) => ({
      ...tag,
      key: `user-genre-${tag.id}`,
      source: 'Personal genre',
      isActive: activeGenres.has(tag.name),
    })),
    ...song.userMoods.map((tag) => ({
      ...tag,
      key: `user-mood-${tag.id}`,
      source: 'Personal mood',
      isActive: activeMoods.has(tag.name),
    })),
  ]

  if (tags.length === 0) {
    return <span className='text-sm text-muted-foreground'>—</span>
  }

  return (
    <p
      className='text-[0.6875rem] leading-relaxed break-words whitespace-normal text-muted-foreground'
      title={tags.map((tag) => tag.name).join(', ')}
    >
      {tags.map((tag, index) => (
        <span key={tag.key}>
          {index > 0 && ', '}
          <span className='sr-only'>{tag.source}: </span>
          <span
            className={cn(
              tag.isActive &&
                'font-semibold text-primary underline decoration-2 underline-offset-2',
            )}
          >
            {tag.name}
          </span>
          {tag.isActive && <span className='sr-only'> (active filter)</span>}
        </span>
      ))}
    </p>
  )
}

const SongArtwork = ({
  isEager = false,
  song,
  size,
}: {
  isEager?: boolean
  song: LibrarySong
  size: 'large' | 'row'
}) => {
  const classes =
    size === 'large'
      ? 'h-auto aspect-square w-full object-cover'
      : 'size-12 object-cover sm:size-18'
  const pixels = size === 'large' ? 560 : 72

  if (song.albumArtUrl === null) {
    return (
      <div
        aria-hidden='true'
        className={cn(
          classes,
          'grid place-items-center bg-muted font-display text-2xl',
        )}
      >
        P
      </div>
    )
  }

  return (
    <Image
      alt=''
      className={classes}
      height={pixels}
      loading={size === 'large' || isEager ? 'eager' : 'lazy'}
      sizes={size === 'large' ? '(min-width: 1024px) 28vw, 100vw' : '4.5rem'}
      src={song.albumArtUrl}
      style={{ height: 'auto' }}
      width={pixels}
    />
  )
}

type SelectedSongProps = {
  className?: string
  song: LibrarySong
  onClose?: () => void
}

const SelectedSong = ({ className, song, onClose }: SelectedSongProps) => {
  const title = song.title ?? 'Untitled'
  const artists =
    song.artists !== null && song.artists.length > 0
      ? song.artists.join(', ')
      : 'Unknown artist'
  const confidenceBand = getConfidenceBand(
    song.enrichmentStatus,
    song.aiConfidence,
  )

  return (
    <aside
      aria-label={`Selected song: ${title}`}
      className={cn(
        'relative border-2 border-border bg-background lg:sticky lg:top-20',
        className,
      )}
    >
      {onClose !== undefined && (
        <div className='sticky top-3 z-20 h-0'>
          <Button
            aria-label={`Close details for ${title}`}
            className='absolute end-3 bg-background/90 backdrop-blur-sm'
            size='icon'
            variant='outline'
            onClick={onClose}
          >
            <XIcon aria-hidden='true' />
          </Button>
        </div>
      )}
      <SongArtwork size='large' song={song} />
      <div className='flex flex-col gap-5 border-t-2 border-border p-4 sm:p-5'>
        <div className='flex flex-col gap-2'>
          <div className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1'>
            <p className='editorial-kicker text-muted-foreground'>
              Selected song
            </p>
            <Badge
              className={cn(
                'justify-self-end',
                confidenceBand === 'pending' &&
                  'border-current bg-transparent text-foreground',
              )}
              variant={confidenceVariant[confidenceBand]}
            >
              {CONFIDENCE_BANDS[confidenceBand].label}
            </Badge>
            {song.aiConfidence !== null && (
              <span className='col-start-2 row-start-2 justify-self-end font-mono text-[0.6875rem] text-muted-foreground tabular-nums'>
                {song.aiConfidence.toFixed(2)}
              </span>
            )}
          </div>
          <h2 className='font-display text-3xl leading-[0.95] tracking-[-0.04em]'>
            {title}
          </h2>
          <p className='text-sm text-muted-foreground'>{artists}</p>
        </div>

        <LibraryTagEditor
          aiAttributes={song.aiAttributes}
          aiConfidence={song.aiConfidence}
          aiGenres={song.aiGenres}
          aiMoods={song.aiMoods}
          display='inline'
          hiddenGenres={song.hiddenGenres}
          hiddenMoods={song.hiddenMoods}
          isCurrentRecipe={song.isCurrentRecipe}
          recipeLabel={song.recipeLabel}
          songId={song.id}
          songTitle={title}
          userGenres={song.userGenres}
          userMoods={song.userMoods}
        />
      </div>
    </aside>
  )
}

export const LibraryTable = ({
  activeBands,
  activeGenres,
  activeMoods,
  songs,
}: LibraryTableProps) => {
  const [selectedSongId, setSelectedSongId] = useState(songs.at(0)?.id)
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false)
  const selectedSong =
    songs.find((song) => song.id === selectedSongId) ?? songs.at(0)
  const activeGenreNames = new Set(activeGenres)
  const activeMoodNames = new Set(activeMoods)
  const activeBandSet = new Set(activeBands)

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 1023px)')
    const handleBreakpointChange = () => {
      if (!mobile.matches) setIsMobilePanelOpen(false)
    }

    mobile.addEventListener('change', handleBreakpointChange)
    return () => {
      mobile.removeEventListener('change', handleBreakpointChange)
    }
  }, [])

  if (selectedSong === undefined) return null

  const handleSelectSong = (songId: string) => {
    setSelectedSongId(songId)
    if (window.matchMedia('(max-width: 1023px)').matches) {
      setIsMobilePanelOpen(true)
    }
  }

  const handleMobilePanelOpenChange = (isOpen: boolean) => {
    setIsMobilePanelOpen(isOpen)
  }

  return (
    <div className='grid items-start gap-6 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.75fr)] xl:gap-10'>
      <div className='hidden lg:block'>
        <SelectedSong song={selectedSong} />
      </div>

      <Dialog
        open={isMobilePanelOpen}
        onOpenChange={handleMobilePanelOpenChange}
      >
        <DialogContent
          className='top-0 right-0 bottom-0 left-auto h-dvh w-[min(92vw,28rem)] max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-0 border-s-2 border-border p-0 ring-0 duration-300 lg:hidden data-open:zoom-in-100 data-open:slide-in-from-right-full data-closed:zoom-out-100 data-closed:slide-out-to-right-full'
          overlayClassName='duration-300'
          showCloseButton={false}
        >
          <DialogTitle className='sr-only'>
            Details for {selectedSong.title ?? 'Untitled'}
          </DialogTitle>
          <SelectedSong
            className='border-0'
            song={selectedSong}
            onClose={() => {
              setIsMobilePanelOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      <div className='min-w-0 border-t-2 border-border'>
        <Table className='table-fixed'>
          <colgroup>
            <col className='w-14 sm:w-21' />
            <col />
            <col className='w-0 md:w-2/5' />
            <col className='w-18 sm:w-28' />
          </colgroup>
          <TableCaption className='sr-only'>
            Your imported Liked Songs, most recently liked first. Select artwork
            to inspect and edit a song.
          </TableCaption>
          <TableHeader>
            <TableRow className='border-border hover:bg-transparent'>
              <TableHead className='px-0 sm:px-1' scope='col'>
                Art
              </TableHead>
              <TableHead className='px-1 text-left sm:px-2' scope='col'>
                Title / Artist
              </TableHead>
              <TableHead className='hidden md:table-cell' scope='col'>
                Tags
              </TableHead>
              <TableHead
                aria-label='Confidence'
                className='px-0.5 text-right sm:px-2'
                scope='col'
              >
                <span className='inline-flex items-center gap-0.5 sm:gap-1'>
                  <span className='sm:hidden'>Conf.</span>
                  <span className='hidden sm:inline'>Confidence</span>
                  <LibraryConfidenceInfo />
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {songs.map((song) => {
              const title = song.title ?? 'Untitled'
              const artists =
                song.artists !== null && song.artists.length > 0
                  ? song.artists.join(', ')
                  : 'Unknown artist'
              const confidenceBand = getConfidenceBand(
                song.enrichmentStatus,
                song.aiConfidence,
              )
              const isSelected = song.id === selectedSong.id

              return (
                <TableRow
                  key={song.id}
                  className={cn(
                    'border-border transition-colors',
                    isSelected && 'bg-muted',
                  )}
                >
                  <TableCell className='px-0 py-2 sm:px-1 sm:py-3'>
                    <button
                      aria-label={`Select ${title} and show its details`}
                      aria-pressed={isSelected}
                      className={cn(
                        'block cursor-pointer border-2 border-transparent transition-colors outline-none focus-visible:border-control focus-visible:ring-2 focus-visible:ring-control-ring/60',
                        isSelected && 'border-control',
                      )}
                      type='button'
                      onClick={() => {
                        handleSelectSong(song.id)
                      }}
                    >
                      <SongArtwork
                        isEager={isSelected}
                        size='row'
                        song={song}
                      />
                    </button>
                  </TableCell>
                  <th
                    className='py-1 ps-1 pe-0 text-left align-middle font-normal text-foreground sm:p-2'
                    scope='row'
                  >
                    <div className='min-w-0'>
                      <span
                        className='block truncate font-semibold'
                        title={title}
                      >
                        {title}
                      </span>
                      <span
                        className='block truncate text-sm text-muted-foreground'
                        title={artists}
                      >
                        {artists}
                      </span>
                    </div>
                  </th>
                  <TableCell className='hidden md:table-cell'>
                    <LibraryTagList
                      activeGenres={activeGenreNames}
                      activeMoods={activeMoodNames}
                      song={song}
                    />
                  </TableCell>
                  <TableCell className='py-1 ps-0 pe-0.5 text-right sm:p-2'>
                    <div className='flex flex-col items-end gap-1'>
                      <Badge
                        className={cn(
                          confidenceBand === 'pending' &&
                            !activeBandSet.has(confidenceBand) &&
                            'border-current bg-transparent text-foreground',
                        )}
                        variant={
                          activeBandSet.has(confidenceBand)
                            ? 'default'
                            : confidenceVariant[confidenceBand]
                        }
                      >
                        {CONFIDENCE_BANDS[confidenceBand].label}
                        {activeBandSet.has(confidenceBand) && (
                          <span className='sr-only'> (active filter)</span>
                        )}
                      </Badge>
                      {song.aiConfidence !== null && (
                        <span className='font-mono text-[0.6875rem] text-muted-foreground tabular-nums'>
                          {song.aiConfidence.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
