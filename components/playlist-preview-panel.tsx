'use client'

import { XIcon } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'

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

type PlaylistPreviewPanelProps = {
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

const formatPlaylistDuration = (durationMs: number): string => {
  if (durationMs <= 0) return 'Duration unknown'
  const totalMinutes = Math.round(durationMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} hr`
  return `${hours} hr ${minutes} min`
}

const COLLAGE_TILE_COUNT = 4

const hashArtworkCandidate = (value: string): number => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const selectCoverArtUrls = (
  tracks: PlaylistProposal['tracks'],
  removedIds: ReadonlySet<string>,
): string[] => {
  const seed = tracks.map((track) => track.songId).join('|')
  const candidates = tracks
    .flatMap((track) =>
      track.albumArtUrl === null
        ? []
        : [
            {
              songId: track.songId,
              url: track.albumArtUrl,
              rank: hashArtworkCandidate(`${seed}:${track.songId}`),
            },
          ],
    )
    .toSorted(
      (left, right) =>
        left.rank - right.rank || left.songId.localeCompare(right.songId),
    )
  const initialCandidates = candidates.slice(0, COLLAGE_TILE_COUNT)
  const replacements = candidates
    .slice(COLLAGE_TILE_COUNT)
    .filter((candidate) => !removedIds.has(candidate.songId))
  let replacementIndex = 0

  return initialCandidates.flatMap((candidate) => {
    if (!removedIds.has(candidate.songId)) return [candidate.url]
    const replacement = replacements.at(replacementIndex)
    replacementIndex += 1
    return replacement === undefined ? [] : [replacement.url]
  })
}

const PlaylistArtworkPlaceholder = ({ imageUrls }: { imageUrls: string[] }) => {
  if (imageUrls.length === 0) {
    return (
      <div
        aria-hidden='true'
        className='grid h-full min-h-56 place-items-center bg-secondary font-display text-8xl text-secondary-foreground md:min-h-72'
      >
        P
      </div>
    )
  }

  return (
    <div
      aria-hidden='true'
      className='grid h-full min-h-56 grid-cols-2 grid-rows-2 gap-px bg-foreground md:min-h-72'
    >
      {Array.from({ length: COLLAGE_TILE_COUNT }, (_, index) => {
        const imageUrl = imageUrls[index % imageUrls.length]
        return (
          <div
            key={`${imageUrl}-${index}`}
            className='relative min-h-0 min-w-0 overflow-hidden bg-muted'
          >
            <Image
              fill
              alt=''
              className='object-cover'
              loading='eager'
              sizes='(min-width: 1024px) 14vw, (min-width: 768px) 20vw, 50vw'
              src={imageUrl}
            />
          </div>
        )
      })}
    </div>
  )
}

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

  const remainingTracks = useMemo(
    () => proposal.tracks.filter((track) => !removedIds.has(track.songId)),
    [proposal.tracks, removedIds],
  )
  const trimmedName = name.trim()
  const coverArtUrls = useMemo(
    () => selectCoverArtUrls(proposal.tracks, removedIds),
    [proposal.tracks, removedIds],
  )
  const playlistDuration = formatPlaylistDuration(
    remainingTracks.reduce(
      (total, track) => total + (track.durationMs ?? 0),
      0,
    ),
  )

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

  const isCreated =
    createState.phase === 'created' || createState.phase === 'partial'
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
      className='flex h-full min-h-0 flex-col border-2 border-border'
    >
      <div className='grid shrink-0 border-b-2 border-border md:grid-cols-[minmax(12rem,0.72fr)_minmax(0,1.28fr)]'>
        <div className='min-h-56 bg-muted md:min-h-72'>
          <PlaylistArtworkPlaceholder imageUrls={coverArtUrls} />
        </div>

        <div className='flex min-w-0 flex-col justify-between gap-5 border-t-2 border-border p-4 sm:p-6 md:border-t-0 md:border-l-2'>
          <div className='flex flex-col gap-4'>
            <p className='editorial-kicker'>Playlist preview</p>
            <div>
              <label className='sr-only' htmlFor='playlist-name'>
                Playlist name
              </label>
              <Input
                className='h-auto rounded-none border-0 border-b-2 border-control bg-transparent px-0 py-2 font-display text-4xl leading-[0.9] tracking-[-0.045em] focus-visible:border-control-ring focus-visible:ring-0 sm:text-5xl dark:bg-transparent'
                id='playlist-name'
                maxLength={PLAYLIST_NAME_MAX}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                }}
              />
            </div>
            <div>
              <label className='sr-only' htmlFor='playlist-description'>
                Description
              </label>
              <Textarea
                className='min-h-16 resize-none rounded-none border-0 border-b border-control bg-transparent px-0 py-2 text-sm leading-relaxed focus-visible:border-control-ring focus-visible:ring-0 dark:bg-transparent'
                id='playlist-description'
                maxLength={PLAYLIST_DESCRIPTION_MAX}
                rows={2}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                }}
              />
            </div>
            <p className='font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase tabular-nums'>
              {remainingTracks.length}{' '}
              {remainingTracks.length === 1 ? 'song' : 'songs'} ·{' '}
              {playlistDuration}
            </p>
          </div>

          <div className='flex flex-col gap-2'>
            {createState.phase === 'reconnect' ? (
              <Button
                className='w-full'
                size='lg'
                onClick={() => void signInWithSpotify()}
              >
                Reconnect Spotify
              </Button>
            ) : (
              !isCreated && (
                <Button
                  className='w-full'
                  disabled={isCreateDisabled}
                  size='lg'
                  onClick={() => void runCreate()}
                >
                  {isCreating ? 'Creating…' : 'Create playlist'}
                </Button>
              )
            )}
            {!isCreated && (
              <Button
                className='w-full'
                disabled={isBusy || isCreating}
                size='lg'
                variant='outline'
                onClick={onRegenerate}
              >
                Regenerate
              </Button>
            )}
          </div>
        </div>
      </div>

      <div
        aria-label='Playlist tracks'
        className='min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-5'
        role='region'
        tabIndex={0}
      >
        {remainingTracks.length > 0 ? (
          <ul className='flex flex-col divide-y divide-border'>
            {remainingTracks.map((track) => {
              const artists =
                track.artists.length > 0 ? track.artists.join(', ') : '—'
              return (
                <li
                  key={track.songId}
                  className='flex items-center gap-4 py-3 first:pt-1'
                >
                  {track.albumArtUrl !== null ? (
                    <Image
                      alt=''
                      className='size-14 shrink-0 object-cover'
                      height={56}
                      src={track.albumArtUrl}
                      width={56}
                    />
                  ) : (
                    <div
                      aria-hidden='true'
                      className='size-14 shrink-0 bg-muted'
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
                      className='rounded-none'
                      disabled={isCreating}
                      size='icon-sm'
                      variant='ghost'
                      onClick={() => {
                        handleRemove(track.songId)
                      }}
                    >
                      <XIcon aria-hidden='true' />
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

      {createState.phase !== 'idle' && (
        <div className='flex shrink-0 flex-col gap-2 border-t-2 border-border bg-secondary/45 p-4 sm:p-5'>
          {createState.phase === 'creating' && (
            <p className='text-sm text-muted-foreground'>
              Creating your playlist in Spotify…
            </p>
          )}
          {createState.phase === 'rate_limited' && (
            <p className='text-sm text-muted-foreground tabular-nums'>
              Spotify rate limit reached — retrying in {createState.secondsLeft}
              s.
            </p>
          )}
          {createState.phase === 'reconnect' && (
            <p className='text-sm text-muted-foreground'>
              Your Spotify connection expired. Reconnect to create this
              playlist.
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
      )}

      <div className='sr-only shrink-0' role='status'>
        {announcement}
      </div>
    </section>
  )
}
