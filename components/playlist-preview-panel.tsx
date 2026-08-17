'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { signInWithSpotify } from '@/lib/auth/spotify'
import {
  type PlaylistProposal,
  readCreatePlaylistResponse,
} from '@/lib/chat/contract'
import { readJson } from '@/lib/json'
import {
  PLAYLIST_DESCRIPTION_MAX,
  PLAYLIST_NAME_MAX,
} from '@/lib/playlists/validation'
import { wait } from '@/lib/sleep'

interface PlaylistPreviewPanelProps {
  proposal: PlaylistProposal
  prompt: string | null
  isBusy: boolean
  onRegenerate: () => void
}

type CreateState =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'reconnect' }
  | { phase: 'rate_limited'; secondsLeft: number }
  | {
      phase: 'partial'
      spotifyUrl: string
      addedCount: number
      requestedCount: number
      persisted: boolean
    }
  | { phase: 'error'; message: string }
  | { phase: 'created'; spotifyUrl: string; persisted: boolean }

/**
 * Renders one playlist proposal for review: rename, edit description, drop
 * tracks, then create it in Spotify. Remounted (via `key`) on each new
 * proposal, so its edit state resets by construction. The create flow is a
 * small state machine mirroring the import panel — a plain async function
 * started by the button, aborted on unmount.
 */
export const PlaylistPreviewPanel = ({
  proposal,
  prompt,
  isBusy,
  onRegenerate,
}: PlaylistPreviewPanelProps) => {
  const [name, setName] = useState(proposal.name)
  const [description, setDescription] = useState(proposal.description)
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [createState, setCreateState] = useState<CreateState>({ phase: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const remainingTracks = proposal.tracks.filter(
    (track) => !removedIds.has(track.songId),
  )
  const trimmedName = name.trim()

  const handleRemove = (songId: string) => {
    setRemovedIds((current) => {
      const next = new Set(current)
      next.add(songId)
      return next
    })
  }

  const runCreate = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    const isStopped = () => signal.aborted

    const songIds = remainingTracks.map((track) => track.songId)
    if (songIds.length === 0 || trimmedName.length === 0) return

    while (!isStopped()) {
      setCreateState({ phase: 'creating' })
      setAnnouncement('Creating your playlist…')

      let response: Response
      try {
        response = await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            description: description.trim(),
            songIds,
            prompt,
          }),
          signal,
        })
      } catch {
        if (isStopped()) return
        setCreateState({
          phase: 'error',
          message: 'Network error — check your connection and retry.',
        })
        setAnnouncement('Playlist creation failed.')
        return
      }
      if (isStopped()) return

      const payload = await readJson(response)
      if (isStopped()) return

      const parsed = readCreatePlaylistResponse(payload)
      if (parsed === null) {
        setCreateState({
          phase: 'error',
          message: 'The server returned an unexpected response.',
        })
        setAnnouncement('Playlist creation failed.')
        return
      }

      if (parsed.status === 'reconnect_required') {
        setCreateState({ phase: 'reconnect' })
        setAnnouncement('Spotify needs to be reconnected.')
        return
      }
      if (parsed.status === 'error') {
        setCreateState({ phase: 'error', message: parsed.message })
        setAnnouncement('Playlist creation failed.')
        return
      }
      if (parsed.status === 'rate_limited') {
        let secondsLeft = parsed.retryAfterSeconds
        setAnnouncement('Spotify rate limit reached; retrying shortly.')
        while (secondsLeft > 0 && !isStopped()) {
          setCreateState({ phase: 'rate_limited', secondsLeft })
          await wait(1000, signal)
          secondsLeft -= 1
        }
        continue
      }
      if (parsed.status === 'partial') {
        setCreateState({
          phase: 'partial',
          spotifyUrl: parsed.spotifyUrl,
          addedCount: parsed.addedCount,
          requestedCount: parsed.requestedCount,
          persisted: parsed.persisted,
        })
        setAnnouncement('Playlist created, but some tracks were skipped.')
        return
      }

      setCreateState({
        phase: 'created',
        spotifyUrl: parsed.spotifyUrl,
        persisted: parsed.persisted,
      })
      setAnnouncement('Playlist created in Spotify.')
      return
    }
  }

  const isCreated = createState.phase === 'created'
  const isCreating =
    createState.phase === 'creating' || createState.phase === 'rate_limited'
  const isCreateDisabled =
    remainingTracks.length === 0 ||
    trimmedName.length === 0 ||
    isBusy ||
    isCreating

  return (
    <section
      aria-label='Playlist preview'
      className='flex h-full min-h-0 flex-col rounded-lg border'
    >
      <div className='flex shrink-0 flex-col gap-4 border-b p-4'>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <label className='text-sm font-medium' htmlFor='playlist-name'>
              Playlist name
            </label>
            <Input
              id='playlist-name'
              maxLength={PLAYLIST_NAME_MAX}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
              }}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <label
              className='text-sm font-medium'
              htmlFor='playlist-description'
            >
              Description
            </label>
            <Textarea
              id='playlist-description'
              maxLength={PLAYLIST_DESCRIPTION_MAX}
              rows={2}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
              }}
            />
          </div>
        </div>

        <div className='flex items-center justify-between gap-2'>
          <p className='text-sm text-muted-foreground tabular-nums'>
            {remainingTracks.length}{' '}
            {remainingTracks.length === 1 ? 'track' : 'tracks'}
          </p>
          <Button
            disabled={isBusy || isCreating}
            size='sm'
            variant='outline'
            onClick={onRegenerate}
          >
            Regenerate
          </Button>
        </div>
      </div>

      <div
        aria-label='Playlist tracks'
        className='min-h-0 flex-1 overflow-y-auto px-4 py-2'
        role='region'
        tabIndex={0}
      >
        {remainingTracks.length > 0 ? (
          <ul className='flex flex-col divide-y'>
            {remainingTracks.map((track) => {
              const artists =
                track.artists.length > 0 ? track.artists.join(', ') : '—'
              return (
                <li
                  key={track.songId}
                  className='flex items-center gap-3 py-2 first:pt-0'
                >
                  {track.albumArtUrl !== null ? (
                    <Image
                      alt=''
                      className='size-10 shrink-0 rounded object-cover'
                      height={40}
                      src={track.albumArtUrl}
                      width={40}
                    />
                  ) : (
                    <div
                      aria-hidden='true'
                      className='size-10 shrink-0 rounded bg-muted'
                    />
                  )}
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium text-foreground'>
                      {track.title}
                    </p>
                    <p className='truncate text-xs text-muted-foreground'>
                      {artists}
                    </p>
                    {track.reason.length > 0 && (
                      <p className='truncate text-xs text-muted-foreground italic'>
                        {track.reason}
                      </p>
                    )}
                  </div>
                  {!isCreated && (
                    <Button
                      aria-label={`Remove ${track.title} from the playlist`}
                      disabled={isCreating}
                      size='sm'
                      variant='ghost'
                      onClick={() => {
                        handleRemove(track.songId)
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className='text-sm text-muted-foreground'>
            All tracks removed. Regenerate for a new set, or keep at least one
            to create the playlist.
          </p>
        )}
      </div>

      <div className='flex shrink-0 flex-col gap-2 border-t p-4'>
        {createState.phase === 'reconnect' ? (
          <Button onClick={() => void signInWithSpotify()}>
            Reconnect Spotify
          </Button>
        ) : (
          !isCreated && (
            <Button
              disabled={isCreateDisabled}
              onClick={() => void runCreate()}
            >
              {isCreating ? 'Creating…' : 'Create playlist'}
            </Button>
          )
        )}

        {createState.phase === 'rate_limited' && (
          <p className='text-sm text-muted-foreground tabular-nums'>
            Spotify rate limit reached — retrying in {createState.secondsLeft}s.
          </p>
        )}
        {createState.phase === 'reconnect' && (
          <p className='text-sm text-muted-foreground'>
            Your Spotify connection expired. Reconnect to create this playlist.
          </p>
        )}
        {createState.phase === 'error' && (
          <p className='text-sm text-destructive'>{createState.message}</p>
        )}
        {createState.phase === 'partial' && (
          <div className='flex flex-col gap-1 text-sm'>
            <p className='text-foreground'>
              Playlist created, but only {createState.addedCount} of{' '}
              {createState.requestedCount} tracks were added.
            </p>
            {!createState.persisted && (
              <p className='text-muted-foreground'>
                It may not appear under Playlists.
              </p>
            )}
            <a
              className='underline underline-offset-4'
              href={createState.spotifyUrl}
              rel='noreferrer'
              target='_blank'
            >
              Open in Spotify
            </a>
          </div>
        )}
        {createState.phase === 'created' && (
          <div className='flex flex-col gap-1 text-sm'>
            <p className='text-foreground'>Playlist created in Spotify.</p>
            {!createState.persisted && (
              <p className='text-muted-foreground'>
                It may not appear under Playlists.
              </p>
            )}
            <a
              className='underline underline-offset-4'
              href={createState.spotifyUrl}
              rel='noreferrer'
              target='_blank'
            >
              Open in Spotify
            </a>
          </div>
        )}
      </div>

      <div className='sr-only shrink-0' role='status'>
        {announcement}
      </div>
    </section>
  )
}
