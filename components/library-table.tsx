import Image from 'next/image'
import Link from 'next/link'

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
import { cn } from '@/lib/utils'

export interface LibrarySong {
  id: string
  title: string | null
  artists: string[] | null
  albumArtUrl: string | null
  enrichmentStatus: string
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

const statusVariant = (status: string): 'default' | 'secondary' | 'outline' =>
  status === 'enriched'
    ? 'default'
    : status === 'pending'
      ? 'secondary'
      : 'outline'

const formatStatus = (status: string) =>
  status.length > 0
    ? status.charAt(0).toUpperCase() + status.slice(1)
    : 'Unknown'

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
            <TableHead className='w-32 text-right' scope='col'>
              Status
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
                <TableCell className='text-right'>
                  <Badge variant={statusVariant(song.enrichmentStatus)}>
                    {formatStatus(song.enrichmentStatus)}
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
