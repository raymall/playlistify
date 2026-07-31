'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { signInWithSpotify } from '@/lib/auth/spotify'
import { readSyncPlaylistStatusesResponse } from '@/lib/playlists/contract'
import { wait } from '@/lib/sleep'

type SyncState =
  | { phase: 'idle' }
  | { phase: 'syncing' }
  | { phase: 'waiting'; secondsLeft: number }
  | { phase: 'reconnect' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; presentCount: number; missingCount: number }

/** Auto-syncs cached Spotify reachability and exposes the manual refresh. */
export const PlaylistStatusPanel = () => {
  const router = useRouter()
  const [state, setState] = useState<SyncState>({ phase: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const runSync = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    const isStopped = () => signal.aborted

    while (!isStopped()) {
      setState({ phase: 'syncing' })
      setAnnouncement('Checking playlists in Spotify…')

      let response: Response
      try {
        response = await fetch('/api/playlists/sync', {
          method: 'POST',
          signal,
        })
      } catch {
        if (isStopped()) return
        setState({
          phase: 'error',
          message: 'Network error — check your connection and try again.',
        })
        setAnnouncement('Playlist status refresh failed.')
        return
      }
      if (isStopped()) return

      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (isStopped()) return

      const parsed = readSyncPlaylistStatusesResponse(payload)
      if (parsed === null) {
        setState({
          phase: 'error',
          message: 'The server returned an unexpected response.',
        })
        setAnnouncement('Playlist status refresh failed.')
        return
      }
      if (parsed.status === 'reconnect_required') {
        setState({ phase: 'reconnect' })
        setAnnouncement('Reconnect Spotify to refresh playlist status.')
        return
      }
      if (parsed.status === 'error') {
        setState({ phase: 'error', message: parsed.message })
        setAnnouncement('Playlist status refresh failed.')
        return
      }
      if (parsed.status === 'rate_limited') {
        let secondsLeft = parsed.retryAfterSeconds
        setAnnouncement('Spotify rate limit reached; retrying shortly.')
        while (secondsLeft > 0 && !isStopped()) {
          setState({ phase: 'waiting', secondsLeft })
          await wait(1_000, signal)
          secondsLeft -= 1
        }
        continue
      }

      setState({
        phase: 'done',
        presentCount: parsed.presentCount,
        missingCount: parsed.missingCount,
      })
      setAnnouncement(
        `Playlist status refreshed. ${parsed.presentCount} in Spotify and ${parsed.missingCount} deleted in Spotify.`,
      )
      router.refresh()
      return
    }
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void runSync()
    }, 0)
    return () => {
      window.clearTimeout(timeoutId)
      abortRef.current?.abort()
    }
  }, [runSync])

  const isBusy = state.phase === 'syncing' || state.phase === 'waiting'

  return (
    <div className='mt-6 flex flex-col items-start gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between'>
      <div className='text-sm text-muted-foreground'>
        {state.phase === 'syncing' && 'Checking Spotify…'}
        {state.phase === 'waiting' && (
          <span className='tabular-nums'>
            Rate limited — retrying in {state.secondsLeft}s
          </span>
        )}
        {state.phase === 'reconnect' &&
          'Reconnect Spotify to check which playlists still exist there.'}
        {state.phase === 'error' && (
          <span className='text-destructive'>{state.message}</span>
        )}
        {state.phase === 'done' && (
          <span className='tabular-nums'>
            {state.presentCount.toLocaleString()} in Spotify ·{' '}
            {state.missingCount.toLocaleString()} deleted
          </span>
        )}
        {state.phase === 'idle' && 'Spotify status has not been checked yet.'}
      </div>

      {state.phase === 'reconnect' ? (
        <Button size='sm' onClick={() => void signInWithSpotify()}>
          Reconnect Spotify
        </Button>
      ) : (
        <Button
          disabled={isBusy}
          size='sm'
          variant='outline'
          onClick={() => void runSync()}
        >
          {isBusy ? 'Refreshing…' : 'Refresh status'}
        </Button>
      )}

      <span className='sr-only' role='status'>
        {announcement}
      </span>
    </div>
  )
}
