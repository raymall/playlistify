import type { Metadata } from 'next'
import Link from 'next/link'

import { PageSection } from '@/components/page-section'
import { PlaylistActions } from '@/components/playlist-actions'
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

export default async function PlaylistsPage() {
  // Route protection lives in proxy.ts; RLS scopes both reads. As on /library,
  // the proxy is the only place that refreshes the Supabase session.
  const supabase = await createClient()

  const [playlistsResult, tagsResult] = await Promise.all([
    supabase
      .from('playlists')
      .select(
        'id, name, description, prompt, spotify_playlist_id, spotify_status, spotify_checked_at, created_at, playlist_songs(count)',
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

  return (
    <PageSection>
      <header className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex flex-col gap-1'>
          <h1 className='text-3xl font-semibold tracking-tight'>Playlists</h1>
          <p className='text-muted-foreground tabular-nums'>
            {playlists.length.toLocaleString()}{' '}
            {playlists.length === 1 ? 'playlist' : 'playlists'}
          </p>
        </div>
        <Link className={buttonVariants()} href='/chat'>
          Start Playlist
        </Link>
      </header>

      {playlists.length > 0 && <PlaylistStatusPanel />}

      {playlists.length === 0 ? (
        <div className='mt-8'>
          <p className='max-w-prose text-sm text-muted-foreground'>
            You haven’t created any playlists yet. Start one from chat and it
            will show up here with its Spotify status and song tags.
          </p>
        </div>
      ) : (
        <ul className='mt-8 grid gap-4'>
          {playlists.map((playlist) => {
            const name = playlist.name ?? 'Untitled playlist'
            const trackCount = playlist.playlist_songs[0]?.count ?? 0
            const created = dateFormatter.format(new Date(playlist.created_at))
            const spotifyStatus = readSpotifyStatus(playlist.spotify_status)
            const status = statusPresentation[spotifyStatus]
            const checkedAt =
              playlist.spotify_checked_at === null
                ? null
                : checkedAtFormatter.format(
                    new Date(playlist.spotify_checked_at),
                  )
            const hasSpotifyPlaylist = playlist.spotify_playlist_id !== null

            return (
              <li
                key={playlist.id}
                className='flex flex-col gap-5 rounded-lg border p-4 sm:p-5'
              >
                <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
                  <div className='min-w-0 space-y-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h2 className='truncate font-medium text-foreground'>
                        {name}
                      </h2>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className='text-sm text-muted-foreground tabular-nums'>
                      {trackCount.toLocaleString()}{' '}
                      {trackCount === 1 ? 'track' : 'tracks'} · Created{' '}
                      {created}
                      {checkedAt === null ? '' : ` · Checked ${checkedAt}`}
                    </p>
                    {playlist.description !== null && (
                      <p className='max-w-prose text-sm text-muted-foreground'>
                        {playlist.description}
                      </p>
                    )}
                    {playlist.prompt !== null && (
                      <p className='max-w-prose text-sm text-muted-foreground italic'>
                        “{playlist.prompt}”
                      </p>
                    )}
                  </div>

                  <PlaylistActions
                    description={playlist.description}
                    hasSpotifyPlaylist={hasSpotifyPlaylist}
                    name={name}
                    playlistId={playlist.id}
                    spotifyStatus={spotifyStatus}
                  />
                </div>

                <div className='flex flex-col gap-2 border-t pt-4'>
                  <h3 className='text-xs font-medium tracking-wide text-muted-foreground uppercase'>
                    Genres and moods
                  </h3>
                  <PlaylistTagChips
                    tags={tagsByPlaylistId.get(playlist.id) ?? []}
                  />
                </div>

                {hasSpotifyPlaylist && spotifyStatus !== 'missing' && (
                  <div>
                    <a
                      aria-label={`Open “${name}” in Spotify`}
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                      })}
                      href={`https://open.spotify.com/playlist/${playlist.spotify_playlist_id}`}
                      rel='noreferrer'
                      target='_blank'
                    >
                      Open in Spotify
                    </a>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </PageSection>
  )
}
