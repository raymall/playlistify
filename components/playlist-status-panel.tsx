'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { signInWithSpotify } from '@/lib/auth/spotify'
import { readJson } from '@/lib/json'
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

      const payload = await readJson(response)
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
    <div className='flex min-w-0 flex-1 flex-col items-stretch gap-1 sm:flex-none sm:items-end'>
      {state.phase === 'reconnect' ? (
        <Button
          className='w-full px-2 text-xs sm:w-auto sm:px-4 sm:text-sm'
          onClick={() => void signInWithSpotify()}
        >
          Reconnect Spotify
        </Button>
      ) : (
        <Button
          className='w-full px-2 text-xs sm:w-auto sm:px-4 sm:text-sm'
          disabled={isBusy}
          variant='secondary'
          onClick={() => void runSync()}
        >
          {isBusy ? 'Refreshing…' : 'Refresh playlists'}
        </Button>
      )}

      {state.phase === 'error' ? (
        <p className='max-w-64 text-xs leading-tight text-destructive sm:text-right'>
          {state.message}
        </p>
      ) : null}

      <span className='sr-only' role='status'>
        {announcement}
      </span>
    </div>
  )
}
