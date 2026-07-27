import Image from 'next/image'
import Link from 'next/link'

import { LibraryAccuracyInfo } from '@/components/library-accuracy-info'
import {
  type LibraryTag,
  LibraryTagEditor,
} from '@/components/library-tag-editor'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
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
  ACCURACY_BANDS,
  type AccuracyBand,
  getAccuracyBand,
} from '@/lib/enrichment/accuracy'
import { type SongAIAttributes } from '@/lib/enrichment/schema'
import { cn } from '@/lib/utils'

export interface LibrarySong {
  id: string
  title: string | null
  artists: string[] | null
  albumArtUrl: string | null
  enrichmentStatus: string
  aiConfidence: number | null
  aiAttributes: SongAIAttributes | null
  aiGenres: string[]
  aiMoods: string[]
  userGenres: LibraryTag[]
  userMoods: LibraryTag[]
}

interface LibraryTableProps {
  page: number
  pageCount: number
  query: string
  songs: LibrarySong[]
}

interface LibraryPaginationProps {
  page: number
  pageCount: number
  query: string
}

/**
 * Visual weight tracks band strength, but the badge always carries its label
 * as text — the band is never conveyed by appearance alone.
 */
const accuracyVariant: Record<
  AccuracyBand,
  'default' | 'secondary' | 'outline' | 'ghost'
> = {
  pending: 'ghost',
  none: 'outline',
  low: 'outline',
  medium: 'secondary',
  high: 'default',
}

const buildHref = (targetPage: number, query: string) => {
  const params = new URLSearchParams()
  if (query.length > 0) params.set('q', query)
  if (targetPage > 1) params.set('page', String(targetPage))
  const search = params.toString()
  return search.length > 0 ? `/library?${search}` : '/library'
}

const LibraryPagination = ({
  page,
  pageCount,
  query,
}: LibraryPaginationProps) => {
  const hasPrev = page > 1
  const hasNext = page < pageCount
  const linkClass = buttonVariants({ variant: 'outline', size: 'sm' })
  const disabledClass = cn(linkClass, 'pointer-events-none opacity-50')

  return (
    <nav
      aria-label='Library pagination'
      className='mt-4 flex items-center justify-between gap-4'
    >
      {hasPrev ? (
        <Link className={linkClass} href={buildHref(page - 1, query)}>
          Previous
        </Link>
      ) : (
        <span aria-disabled='true' className={disabledClass}>
          Previous
        </span>
      )}
      <span className='text-sm text-muted-foreground tabular-nums'>
        Page {page} of {pageCount}
      </span>
      {hasNext ? (
        <Link className={linkClass} href={buildHref(page + 1, query)}>
          Next
        </Link>
      ) : (
        <span aria-disabled='true' className={disabledClass}>
          Next
        </span>
      )}
    </nav>
  )
}

interface LibraryTagChipsProps {
  song: LibrarySong
}

/**
 * AI tags (filled) and the user's own tags (outlined) — variant is the
 * distinction, never hue, per the monochrome theme.
 */
const LibraryTagChips = ({ song }: LibraryTagChipsProps) => {
  const hasTags =
    song.aiGenres.length > 0 ||
    song.aiMoods.length > 0 ||
    song.userGenres.length > 0 ||
    song.userMoods.length > 0

  if (!hasTags) {
    return <span className='text-sm text-muted-foreground'>—</span>
  }

  return (
    <div className='flex flex-wrap items-center gap-1'>
      {song.aiGenres.map((name) => (
        <Badge key={`ai-genre-${name}`} variant='secondary'>
          <span className='sr-only'>AI genre: </span>
          {name}
        </Badge>
      ))}
      {song.aiMoods.map((name) => (
        <Badge key={`ai-mood-${name}`} variant='secondary'>
          <span className='sr-only'>AI mood: </span>
          {name}
        </Badge>
      ))}
      {song.userGenres.map((tag) => (
        <Badge key={`user-genre-${tag.id}`} variant='outline'>
          <span className='sr-only'>Your genre: </span>
          {tag.name}
        </Badge>
      ))}
      {song.userMoods.map((tag) => (
        <Badge key={`user-mood-${tag.id}`} variant='outline'>
          <span className='sr-only'>Your mood: </span>
          {tag.name}
        </Badge>
      ))}
    </div>
  )
}

export const LibraryTable = ({
  page,
  pageCount,
  query,
  songs,
}: LibraryTableProps) => {
  return (
    <div>
      <Table className='table-fixed'>
        <TableCaption className='sr-only'>
          Your imported Liked Songs
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className='w-16' scope='col'>
              <span className='sr-only'>Artwork</span>
            </TableHead>
            <TableHead scope='col'>Title</TableHead>
            <TableHead scope='col'>Artists</TableHead>
            <TableHead className='w-2/5' scope='col'>
              Tags
            </TableHead>
            <TableHead className='w-32 text-right' scope='col'>
              <span className='inline-flex items-center gap-1'>
                Accuracy
                <LibraryAccuracyInfo />
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {songs.map((song) => {
            const titleText = song.title ?? 'Untitled'
            const artistsText =
              song.artists !== null && song.artists.length > 0
                ? song.artists.join(', ')
                : '—'
            const accuracyBand = getAccuracyBand(
              song.enrichmentStatus,
              song.aiConfidence,
            )
            return (
              <TableRow key={song.id}>
                <TableCell>
                  {song.albumArtUrl !== null ? (
                    <Image
                      alt=''
                      className='size-10 object-cover'
                      height={40}
                      src={song.albumArtUrl}
                      width={40}
                    />
                  ) : (
                    <div aria-hidden='true' className='size-10 bg-muted' />
                  )}
                </TableCell>
                <TableCell className='font-medium text-foreground'>
                  <span
                    className='block truncate'
                    title={song.title ?? undefined}
                  >
                    {titleText}
                  </span>
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  <span
                    className='block truncate'
                    title={artistsText === '—' ? undefined : artistsText}
                  >
                    {artistsText}
                  </span>
                </TableCell>
                <TableCell>
                  <div className='flex items-start gap-1'>
                    <div className='min-w-0 flex-1'>
                      <LibraryTagChips song={song} />
                    </div>
                    <LibraryTagEditor
                      aiAttributes={song.aiAttributes}
                      aiConfidence={song.aiConfidence}
                      songId={song.id}
                      songTitle={titleText}
                      userGenres={song.userGenres}
                      userMoods={song.userMoods}
                    />
                  </div>
                </TableCell>
                <TableCell className='text-right'>
                  <Badge variant={accuracyVariant[accuracyBand]}>
                    {ACCURACY_BANDS[accuracyBand].label}
                  </Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <LibraryPagination page={page} pageCount={pageCount} query={query} />
    </div>
  )
}
