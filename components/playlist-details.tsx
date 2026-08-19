'use client'

import { PlaylistActions } from '@/components/playlist-actions'
import {
  PlaylistTagChips,
  type PlaylistTagSummary,
} from '@/components/playlist-tag-chips'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

type SpotifyStatus = 'missing' | 'present' | 'unknown'

type PlaylistDetailsProps = {
  checkedAt: string | null
  created: string
  description: string | null
  hasSpotifyPlaylist: boolean
  isFeatured?: boolean
  name: string
  playlistId: string
  prompt: string | null
  spotifyStatus: SpotifyStatus
  statusLabel: string
  tags: PlaylistTagSummary[]
  trackCount: number
}

export const PlaylistDetails = ({
  checkedAt,
  created,
  description,
  hasSpotifyPlaylist,
  isFeatured = false,
  name,
  playlistId,
  prompt,
  spotifyStatus,
  statusLabel,
  tags,
  trackCount,
}: PlaylistDetailsProps) => (
  <Dialog>
    <DialogTrigger
      render={
        <Button
          aria-label={`See details for “${name}”`}
          className={isFeatured ? 'w-full' : undefined}
          size={isFeatured ? 'lg' : 'sm'}
          variant='outline'
        />
      }
    >
      See details
    </DialogTrigger>
    <DialogContent className='max-h-[90dvh] overflow-y-auto border-2 border-border sm:max-w-2xl'>
      <DialogHeader className='border-b border-border pb-5'>
        <p className='editorial-kicker'>Playlist record</p>
        <DialogTitle className='font-display text-4xl leading-[0.9] tracking-[-0.045em] uppercase sm:text-5xl'>
          {name}
        </DialogTitle>
        <DialogDescription>
          Full context and management for this Playlistify playlist.
        </DialogDescription>
      </DialogHeader>

      <dl className='grid grid-cols-2 border border-border sm:grid-cols-4'>
        <div className='border-b border-border p-3 sm:border-r sm:border-b-0'>
          <dt className='editorial-kicker text-muted-foreground'>Tracks</dt>
          <dd className='mt-2 font-mono text-sm tabular-nums'>{trackCount}</dd>
        </div>
        <div className='border-b border-border p-3 sm:border-r sm:border-b-0'>
          <dt className='editorial-kicker text-muted-foreground'>Created</dt>
          <dd className='mt-2 font-mono text-sm'>{created}</dd>
        </div>
        <div className='border-b border-border p-3 sm:border-r sm:border-b-0'>
          <dt className='editorial-kicker text-muted-foreground'>Spotify</dt>
          <dd className='mt-2'>
            <Badge variant='outline'>{statusLabel}</Badge>
          </dd>
        </div>
        <div className='p-3'>
          <dt className='editorial-kicker text-muted-foreground'>Checked</dt>
          <dd className='mt-2 font-mono text-sm'>{checkedAt ?? 'Not yet'}</dd>
        </div>
      </dl>

      {description !== null && (
        <section className='border-b border-border pb-4'>
          <h3 className='editorial-kicker text-muted-foreground'>
            Description
          </h3>
          <p className='mt-2 text-sm'>{description}</p>
        </section>
      )}

      {prompt !== null && (
        <section className='border-b border-border pb-4'>
          <h3 className='editorial-kicker text-muted-foreground'>
            Original prompt
          </h3>
          <blockquote className='mt-2 font-display text-2xl leading-tight tracking-[-0.03em]'>
            “{prompt}”
          </blockquote>
        </section>
      )}

      <section className='flex flex-col gap-3 border-b border-border pb-4'>
        <h3 className='editorial-kicker text-muted-foreground'>Tags</h3>
        <PlaylistTagChips tags={tags} />
      </section>

      <section className='flex flex-col gap-3'>
        <h3 className='editorial-kicker text-muted-foreground'>Manage</h3>
        <PlaylistActions
          description={description}
          hasSpotifyPlaylist={hasSpotifyPlaylist}
          name={name}
          playlistId={playlistId}
          spotifyStatus={spotifyStatus}
        />
      </section>
    </DialogContent>
  </Dialog>
)
