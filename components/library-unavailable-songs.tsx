import { ExternalLinkIcon } from 'lucide-react'
import Image from 'next/image'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { type LibrarySongSources } from '@/lib/library/song'
import {
  getUnavailableSongs,
  type UnavailableSong,
} from '@/lib/library/unavailable'
import { createClient } from '@/lib/supabase/server'

const pluralize = (count: number, singular: string, plural: string) =>
  `${count.toLocaleString()} ${count === 1 ? singular : plural}`

/** Where to go in Spotify to remove or replace the song. */
const describeSources = (sources: LibrarySongSources) => {
  const parts: string[] = []
  if (sources.isLiked) parts.push('Liked Songs')
  if (sources.playlistCount > 0) {
    parts.push(pluralize(sources.playlistCount, 'playlist', 'playlists'))
  }
  if (sources.albumCount > 0) {
    parts.push(pluralize(sources.albumCount, 'saved album', 'saved albums'))
  }
  return parts.join(' · ')
}

const UnavailableSongRow = ({ song }: { song: UnavailableSong }) => {
  const title = song.title ?? 'Untitled'
  const artists =
    song.artists !== null && song.artists.length > 0
      ? song.artists.join(', ')
      : 'Unknown artist'
  const sources = describeSources(song.sources)

  return (
    <li className='grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 last:border-b-0'>
      {song.albumArtUrl === null ? (
        <div
          aria-hidden='true'
          className='grid size-12 place-items-center bg-muted font-display text-xl'
        >
          P
        </div>
      ) : (
        <Image
          alt=''
          className='size-12 object-cover grayscale'
          height={48}
          loading='lazy'
          sizes='3rem'
          src={song.albumArtUrl}
          width={48}
        />
      )}
      <div className='min-w-0'>
        <p className='truncate font-medium'>{title}</p>
        <p className='truncate text-muted-foreground'>
          {artists}
          {song.album !== null && ` — ${song.album}`}
        </p>
        {sources.length > 0 && (
          <p className='truncate text-xs text-muted-foreground'>
            <span className='sr-only'>In: </span>
            {sources}
          </p>
        )}
      </div>
      <a
        aria-label={`Open “${title}” in Spotify (opens in a new tab)`}
        className={buttonVariants({ size: 'icon', variant: 'ghost' })}
        href={`https://open.spotify.com/track/${song.spotifyTrackId}`}
        rel='noreferrer'
        target='_blank'
        title='Open in Spotify'
      >
        <ExternalLinkIcon aria-hidden='true' />
      </a>
    </li>
  )
}

/**
 * The Library's "no longer available" notice: renders nothing until a sync
 * has found at least one song Spotify will not play for this user, then a
 * one-line notice whose button opens the list.
 */
export const LibraryUnavailableSongs = async () => {
  const supabase = await createClient()
  const { songs, totalCount } = await getUnavailableSongs(supabase)
  if (totalCount === 0) return null

  const countLabel = pluralize(totalCount, 'song', 'songs')

  return (
    <section
      aria-label='Unavailable songs'
      className='flex flex-col gap-3 border-2 border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6'
    >
      <p className='text-sm'>
        <span className='font-medium'>{countLabel}</span> in your library{' '}
        {totalCount === 1 ? 'is' : 'are'} no longer available on Spotify.
      </p>
      <Dialog>
        <DialogTrigger
          render={<Button className='w-full sm:w-auto' variant='outline' />}
        >
          View unavailable songs
        </DialogTrigger>
        <DialogContent className='max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-2 border-border sm:max-w-2xl'>
          <DialogHeader className='border-b border-border pe-10 pb-4'>
            <p className='editorial-kicker'>No longer available</p>
            <DialogTitle className='font-display text-4xl leading-[0.9] tracking-[-0.045em] uppercase sm:text-5xl'>
              {countLabel}
            </DialogTitle>
            <DialogDescription>
              Spotify won’t play these for your account any more — usually
              because the release was pulled or isn’t licensed in your country.
              They stay in your library, so each is listed with the Spotify
              sources that still hold it. Checked on every sync.
            </DialogDescription>
          </DialogHeader>
          <div className='min-h-0 overflow-y-auto pr-1'>
            <ul aria-label='Unavailable songs'>
              {songs.map((song) => (
                <UnavailableSongRow key={song.id} song={song} />
              ))}
            </ul>
            {songs.length < totalCount && (
              <p className='pt-3 text-xs text-muted-foreground'>
                Showing the newest {songs.length.toLocaleString()} of{' '}
                {totalCount.toLocaleString()}.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
