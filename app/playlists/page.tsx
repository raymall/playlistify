import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { PageSection } from '@/components/page-section'
import { PlaylistDetails } from '@/components/playlist-details'
import { PlaylistStatusPanel } from '@/components/playlist-status-panel'
import {
  PlaylistTagChips,
  type PlaylistTagSummary,
} from '@/components/playlist-tag-chips'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Playlists',
}

const PLAYLISTS_LIMIT = 100

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const checkedAtFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

type SpotifyStatus = 'missing' | 'present' | 'unknown'

const readSpotifyStatus = (value: string): SpotifyStatus =>
  value === 'missing' || value === 'present' ? value : 'unknown'

const readTagKind = (value: string): PlaylistTagSummary['kind'] | null =>
  value === 'ai_genre' ||
  value === 'ai_mood' ||
  value === 'personal_genre' ||
  value === 'personal_mood'
    ? value
    : null

const statusPresentation: Record<
  SpotifyStatus,
  { label: string; variant: 'ghost' | 'outline' | 'secondary' }
> = {
  missing: { label: 'Deleted in Spotify', variant: 'outline' },
  present: { label: 'In Spotify', variant: 'secondary' },
  unknown: { label: 'Status unknown', variant: 'ghost' },
}

type PlaylistCoverProps = {
  imageUrl: string | null
  isFeatured?: boolean
  name: string
  spotifyUrl: string | null
}

const PlaylistCover = ({
  imageUrl,
  isFeatured = false,
  name,
  spotifyUrl,
}: PlaylistCoverProps) => {
  const artwork =
    imageUrl === null ? (
      <div
        aria-hidden='true'
        className={
          isFeatured
            ? 'grid h-full min-h-80 w-full place-items-center bg-secondary font-display text-[clamp(4rem,12vw,10rem)] text-secondary-foreground'
            : 'grid aspect-square w-full place-items-center bg-secondary font-display text-[clamp(4rem,12vw,10rem)] text-secondary-foreground'
        }
      >
        P
      </div>
    ) : (
      <Image
        alt=''
        className={
          isFeatured
            ? 'h-full min-h-80 w-full object-cover'
            : 'aspect-square h-auto w-full object-cover'
        }
        height={isFeatured ? 760 : 480}
        priority={isFeatured}
        sizes={
          isFeatured
            ? '(min-width: 1024px) 48vw, 100vw'
            : '(min-width: 1280px) 30vw, (min-width: 640px) 48vw, 100vw'
        }
        src={imageUrl}
        width={isFeatured ? 760 : 480}
      />
    )

  if (spotifyUrl === null) return artwork

  return (
    <a
      aria-label={`Open “${name}” in Spotify`}
      className={
        isFeatured
          ? 'group block h-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'
          : 'group block outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'
      }
      href={spotifyUrl}
      rel='noreferrer'
      target='_blank'
    >
      {artwork}
    </a>
  )
}

export default async function PlaylistsPage() {
  const supabase = await createClient()

  const [playlistsResult, tagsResult] = await Promise.all([
    supabase
      .from('playlists')
      .select(
        'id, name, description, prompt, spotify_playlist_id, spotify_image_url, spotify_status, spotify_checked_at, created_at, playlist_songs(count)',
      )
      .order('created_at', { ascending: false })
      .limit(PLAYLISTS_LIMIT),
    supabase.rpc('playlist_tag_summary'),
  ])

  const playlists = playlistsResult.data ?? []
  const tagsByPlaylistId = new Map<string, PlaylistTagSummary[]>()
  for (const row of tagsResult.data ?? []) {
    const kind = readTagKind(row.kind)
    if (kind === null) continue
    const tag = { kind, name: row.name, songCount: row.song_count }
    const existing = tagsByPlaylistId.get(row.playlist_id)
    if (existing === undefined) {
      tagsByPlaylistId.set(row.playlist_id, [tag])
    } else {
      existing.push(tag)
    }
  }

  const playlistViews = playlists.map((playlist) => {
    const spotifyStatus = readSpotifyStatus(playlist.spotify_status)
    const hasSpotifyPlaylist = playlist.spotify_playlist_id !== null
    return {
      ...playlist,
      name: playlist.name ?? 'Untitled playlist',
      trackCount: playlist.playlist_songs[0]?.count ?? 0,
      created: dateFormatter.format(new Date(playlist.created_at)),
      checkedAt:
        playlist.spotify_checked_at === null
          ? null
          : checkedAtFormatter.format(new Date(playlist.spotify_checked_at)),
      hasSpotifyPlaylist,
      spotifyStatus,
      spotifyUrl:
        hasSpotifyPlaylist && spotifyStatus !== 'missing'
          ? `https://open.spotify.com/playlist/${playlist.spotify_playlist_id}`
          : null,
      status: statusPresentation[spotifyStatus],
      tags: tagsByPlaylistId.get(playlist.id) ?? [],
    }
  })
  const featured = playlistViews.at(0)
  const remaining = playlistViews.slice(1)

  return (
    <PageSection>
      <header className='flex flex-col gap-5 border-b-2 border-border pb-8 sm:flex-row sm:items-end sm:justify-between'>
        <div className='flex flex-col gap-4'>
          <p className='editorial-kicker'>03 / Made by Playlistify for you</p>
          <h1 className='editorial-title'>Playlists</h1>
        </div>
        <div className='flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center'>
          <Link
            className={buttonVariants({
              className: 'w-full sm:w-auto',
              variant: 'outline',
            })}
            href='/chat'
          >
            Start playlist
          </Link>
          {playlists.length > 0 ? <PlaylistStatusPanel /> : null}
        </div>
      </header>

      {featured === undefined ? (
        <div className='mt-12 flex min-h-72 flex-col justify-between border-2 border-border p-6'>
          <p className='editorial-kicker'>No records yet</p>
          <p className='max-w-2xl font-display text-4xl leading-[0.95] tracking-[-0.04em] uppercase sm:text-6xl'>
            Your first playlist is one conversation away.
          </p>
        </div>
      ) : (
        <>
          <article className='mt-10 grid border-2 border-border lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]'>
            <PlaylistCover
              isFeatured
              imageUrl={featured.spotify_image_url}
              name={featured.name}
              spotifyUrl={featured.spotifyUrl}
            />
            <div className='flex flex-col justify-between gap-8 border-t-2 border-border p-5 sm:p-8 lg:border-t-0 lg:border-l-2'>
              <div className='flex flex-col gap-5'>
                <div className='flex items-center justify-between gap-3'>
                  <p className='editorial-kicker'>Featured / newest</p>
                  <Badge variant={featured.status.variant}>
                    {featured.status.label}
                  </Badge>
                </div>
                {featured.spotifyUrl === null ? (
                  <h2 className='editorial-section-title'>{featured.name}</h2>
                ) : (
                  <a
                    className='editorial-section-title transition-colors hover:text-control focus-visible:outline-2 focus-visible:outline-offset-4'
                    href={featured.spotifyUrl}
                    rel='noreferrer'
                    target='_blank'
                  >
                    {featured.name}
                  </a>
                )}
                <p className='font-mono text-xs text-muted-foreground uppercase tabular-nums'>
                  {featured.trackCount} tracks · {featured.created}
                </p>
                {featured.description !== null && (
                  <p className='max-w-prose text-sm text-muted-foreground'>
                    {featured.description}
                  </p>
                )}
                <PlaylistTagChips tags={featured.tags} />
              </div>

              <div className='grid w-full gap-2'>
                {featured.spotifyUrl !== null && (
                  <a
                    aria-label={`Open “${featured.name}” in Spotify`}
                    className={buttonVariants({
                      className: 'w-full',
                      size: 'lg',
                    })}
                    href={featured.spotifyUrl}
                    rel='noreferrer'
                    target='_blank'
                  >
                    Open in Spotify
                  </a>
                )}
                <PlaylistDetails
                  isFeatured
                  checkedAt={featured.checkedAt}
                  created={featured.created}
                  description={featured.description}
                  hasSpotifyPlaylist={featured.hasSpotifyPlaylist}
                  name={featured.name}
                  playlistId={featured.id}
                  prompt={featured.prompt}
                  spotifyStatus={featured.spotifyStatus}
                  statusLabel={featured.status.label}
                  tags={featured.tags}
                  trackCount={featured.trackCount}
                />
              </div>
            </div>
          </article>

          {remaining.length > 0 && (
            <section aria-labelledby='playlist-grid-heading' className='mt-14'>
              <div className='mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3'>
                <h2
                  className='editorial-section-title'
                  id='playlist-grid-heading'
                >
                  More playlists
                </h2>
                <p className='editorial-kicker text-muted-foreground'>
                  {remaining.length.toLocaleString()}{' '}
                  {remaining.length === 1 ? 'playlist' : 'playlists'}
                </p>
              </div>
              <ul className='grid gap-x-5 gap-y-10 sm:grid-cols-2 xl:grid-cols-3'>
                {remaining.map((playlist, index) => (
                  <li key={playlist.id} className='flex min-w-0 flex-col gap-4'>
                    <PlaylistCover
                      imageUrl={playlist.spotify_image_url}
                      name={playlist.name}
                      spotifyUrl={playlist.spotifyUrl}
                    />
                    <div className='flex flex-1 flex-col gap-3 border-t border-border pt-3'>
                      <div className='flex items-start justify-between gap-3'>
                        <p className='editorial-kicker text-muted-foreground'>
                          {String(index + 2).padStart(2, '0')}
                        </p>
                        <Badge variant={playlist.status.variant}>
                          {playlist.status.label}
                        </Badge>
                      </div>
                      {playlist.spotifyUrl === null ? (
                        <h3 className='font-display text-3xl leading-[0.95] tracking-[-0.04em] uppercase'>
                          {playlist.name}
                        </h3>
                      ) : (
                        <a
                          className='font-display text-3xl leading-[0.95] tracking-[-0.04em] uppercase underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4'
                          href={playlist.spotifyUrl}
                          rel='noreferrer'
                          target='_blank'
                        >
                          {playlist.name}
                        </a>
                      )}
                      <p className='font-mono text-[0.6875rem] text-muted-foreground uppercase tabular-nums'>
                        {playlist.trackCount} tracks · {playlist.created}
                      </p>
                      <div className='mt-auto pt-2'>
                        <PlaylistDetails
                          checkedAt={playlist.checkedAt}
                          created={playlist.created}
                          description={playlist.description}
                          hasSpotifyPlaylist={playlist.hasSpotifyPlaylist}
                          name={playlist.name}
                          playlistId={playlist.id}
                          prompt={playlist.prompt}
                          spotifyStatus={playlist.spotifyStatus}
                          statusLabel={playlist.status.label}
                          tags={playlist.tags}
                          trackCount={playlist.trackCount}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PageSection>
  )
}
