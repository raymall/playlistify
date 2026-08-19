'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { signInWithSpotify } from '@/lib/auth/spotify'
import { readJson } from '@/lib/json'
import {
  readDeletePlaylistResponse,
  readRecreatePlaylistResponse,
  readUpdatePlaylistDetailsResponse,
} from '@/lib/playlists/contract'
import {
  PLAYLIST_DESCRIPTION_MAX,
  PLAYLIST_NAME_MAX,
} from '@/lib/playlists/validation'

type SpotifyStatus = 'missing' | 'present' | 'unknown'

type PlaylistActionsProps = {
  description: string | null
  hasSpotifyPlaylist: boolean
  name: string
  playlistId: string
  spotifyStatus: SpotifyStatus
}

type BusyAction = 'delete' | 'edit' | 'recreate' | null

type Feedback = {
  kind: 'error' | 'message' | 'reconnect'
  message: string
} | null

/** Edit, recreate, and destructive controls for one stored playlist. */
export const PlaylistActions = ({
  description,
  hasSpotifyPlaylist,
  name,
  playlistId,
  spotifyStatus,
}: PlaylistActionsProps) => {
  const router = useRouter()
  const editErrorId = useId()
  const deleteDescriptionId = useId()
  const deleteErrorId = useId()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [editedName, setEditedName] = useState(name)
  const [editedDescription, setEditedDescription] = useState(description ?? '')
  const [editError, setEditError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const refreshTimeoutRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current)
      }
    },
    [],
  )

  const startRequest = () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setFeedback(null)
    return controller
  }

  const handleEditOpenChange = (isOpen: boolean) => {
    setIsEditOpen(isOpen)
    setEditError(null)
    if (isOpen) {
      setEditedName(name)
      setEditedDescription(description ?? '')
    }
  }

  const handleDeleteOpenChange = (isOpen: boolean) => {
    setIsDeleteOpen(isOpen)
    setDeleteError(null)
  }

  const handleEdit = async () => {
    const trimmedName = editedName.trim()
    const trimmedDescription = editedDescription.trim()
    if (trimmedName.length === 0) {
      setEditError('Enter a playlist title.')
      return
    }
    if (
      trimmedName.length > PLAYLIST_NAME_MAX ||
      trimmedDescription.length > PLAYLIST_DESCRIPTION_MAX
    ) {
      setEditError('The playlist details are too long.')
      return
    }

    const controller = startRequest()
    const isStopped = () => controller.signal.aborted
    setBusyAction('edit')
    setEditError(null)
    setAnnouncement(`Saving changes to “${name}”…`)
    try {
      const response = await fetch('/api/playlists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playlistId,
          name: trimmedName,
          description: trimmedDescription,
        }),
        signal: controller.signal,
      })
      if (isStopped()) return
      const parsed = readUpdatePlaylistDetailsResponse(await readJson(response))
      if (isStopped()) return
      if (parsed === null) {
        setEditError('The server returned an unexpected response.')
        setAnnouncement('Playlist update failed.')
        return
      }
      if (parsed.status === 'updated') {
        const message = parsed.didUpdateSpotify
          ? 'Saved here and in Spotify.'
          : 'Saved here. This playlist is no longer in Spotify.'
        setFeedback({ kind: 'message', message })
        setAnnouncement(`${message} Playlist title: “${trimmedName}”.`)
        setIsEditOpen(false)
        router.refresh()
        return
      }
      if (parsed.status === 'reconnect_required') {
        const message = 'Reconnect Spotify before changing this playlist.'
        setFeedback({ kind: 'reconnect', message })
        setAnnouncement(message)
        setIsEditOpen(false)
        return
      }
      if (parsed.status === 'rate_limited') {
        setEditError(
          `Spotify is rate limited. Nothing changed; try again in ${parsed.retryAfterSeconds}s.`,
        )
        setAnnouncement('Playlist update was delayed by Spotify.')
        return
      }
      setEditError(parsed.message)
      setAnnouncement('Playlist update failed.')
    } catch {
      if (isStopped()) return
      setEditError('Network error — check your connection and try again.')
      setAnnouncement('Playlist update failed.')
    } finally {
      if (abortRef.current === controller) setBusyAction(null)
    }
  }

  const handleDelete = async () => {
    const controller = startRequest()
    const isStopped = () => controller.signal.aborted
    setBusyAction('delete')
    setDeleteError(null)
    setAnnouncement(`Deleting “${name}”…`)
    try {
      const response = await fetch('/api/playlists', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId }),
        signal: controller.signal,
      })
      if (isStopped()) return
      const parsed = readDeletePlaylistResponse(await readJson(response))
      if (isStopped()) return
      if (parsed === null) {
        setDeleteError('The server returned an unexpected response.')
        setAnnouncement('Playlist deletion failed.')
        return
      }
      if (parsed.status === 'deleted') {
        setIsDeleteOpen(false)
        setAnnouncement(
          parsed.didDeleteSpotify
            ? `Deleted “${name}” here and unfollowed it in Spotify.`
            : `Deleted “${name}” from Playlistify. It was not removed from Spotify.`,
        )
        refreshTimeoutRef.current = window.setTimeout(() => {
          router.refresh()
        }, 300)
        return
      }
      if (parsed.status === 'reconnect_required') {
        const message = 'Reconnect Spotify and try deleting again.'
        setFeedback({ kind: 'reconnect', message })
        setDeleteError(message)
        setAnnouncement('Spotify needs to be reconnected.')
        return
      }
      if (parsed.status === 'rate_limited') {
        const message = `Spotify is rate limited. Try again in ${parsed.retryAfterSeconds}s.`
        setDeleteError(message)
        setAnnouncement('Playlist deletion was delayed by Spotify.')
        return
      }
      setDeleteError(parsed.message)
      setAnnouncement('Playlist deletion failed.')
    } catch {
      if (isStopped()) return
      setDeleteError('Network error — check your connection and try again.')
      setAnnouncement('Playlist deletion failed.')
    } finally {
      if (abortRef.current === controller) setBusyAction(null)
    }
  }

  const handleRecreate = async () => {
    const controller = startRequest()
    const isStopped = () => controller.signal.aborted
    setBusyAction('recreate')
    setAnnouncement(`Recreating “${name}” in Spotify…`)
    try {
      const response = await fetch('/api/playlists/recreate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId }),
        signal: controller.signal,
      })
      if (isStopped()) return
      const parsed = readRecreatePlaylistResponse(await readJson(response))
      if (isStopped()) return
      if (parsed === null) {
        const message = 'The server returned an unexpected response.'
        setFeedback({ kind: 'error', message })
        setAnnouncement('Playlist recreation failed.')
        return
      }
      if (parsed.status === 'recreated') {
        const message = `Recreated with ${parsed.addedCount.toLocaleString()} of ${parsed.requestedCount.toLocaleString()} tracks.`
        setFeedback({ kind: 'message', message })
        setAnnouncement(`${message} “${name}” is back in Spotify.`)
        router.refresh()
        return
      }
      if (parsed.status === 'reconnect_required') {
        const message = 'Reconnect Spotify to recreate this playlist.'
        setFeedback({ kind: 'reconnect', message })
        setAnnouncement(message)
        return
      }
      if (parsed.status === 'rate_limited') {
        const message = `Spotify is rate limited. Try again in ${parsed.retryAfterSeconds}s.`
        setFeedback({ kind: 'error', message })
        setAnnouncement('Playlist recreation was delayed by Spotify.')
        return
      }
      setFeedback({ kind: 'error', message: parsed.message })
      setAnnouncement('Playlist recreation failed.')
    } catch {
      if (isStopped()) return
      setFeedback({
        kind: 'error',
        message: 'Network error — check your connection and try again.',
      })
      setAnnouncement('Playlist recreation failed.')
    } finally {
      if (abortRef.current === controller) setBusyAction(null)
    }
  }

  const isBusy = busyAction !== null
  const canRecreate = spotifyStatus === 'missing' || !hasSpotifyPlaylist
  const deleteDescription =
    spotifyStatus === 'missing' || !hasSpotifyPlaylist
      ? 'This removes the stored playlist from Playlistify. Its Spotify copy is already missing or was never linked.'
      : 'This removes the stored playlist from Playlistify and unfollows it in Spotify. This cannot be undone.'

  return (
    <div className='flex w-full flex-col gap-2'>
      <div className='grid w-full grid-cols-2 gap-2'>
        <Dialog open={isEditOpen} onOpenChange={handleEditOpenChange}>
          <DialogTrigger
            render={
              <Button
                aria-label={`Edit “${name}”`}
                className='order-2 w-full'
                disabled={isBusy}
                size='sm'
                variant='outline'
              />
            }
          >
            Edit
          </DialogTrigger>
          <DialogContent>
            <form
              className='flex flex-col gap-4'
              onSubmit={(event) => {
                event.preventDefault()
                void handleEdit()
              }}
            >
              <DialogHeader>
                <DialogTitle>Edit “{name}”</DialogTitle>
                <DialogDescription>
                  Spotify is the source of truth while this playlist exists
                  there. Missing playlists are edited only in Playlistify.
                </DialogDescription>
              </DialogHeader>

              <div className='flex flex-col gap-3'>
                <div className='flex flex-col gap-1.5'>
                  <label
                    className='text-sm font-medium'
                    htmlFor={`${editErrorId}-name`}
                  >
                    Playlist title
                  </label>
                  <Input
                    aria-describedby={
                      editError === null ? undefined : editErrorId
                    }
                    id={`${editErrorId}-name`}
                    maxLength={PLAYLIST_NAME_MAX}
                    value={editedName}
                    onChange={(event) => {
                      setEditedName(event.target.value)
                    }}
                  />
                </div>
                <div className='flex flex-col gap-1.5'>
                  <label
                    className='text-sm font-medium'
                    htmlFor={`${editErrorId}-description`}
                  >
                    Description
                  </label>
                  <Textarea
                    aria-describedby={
                      editError === null ? undefined : editErrorId
                    }
                    id={`${editErrorId}-description`}
                    maxLength={PLAYLIST_DESCRIPTION_MAX}
                    rows={3}
                    value={editedDescription}
                    onChange={(event) => {
                      setEditedDescription(event.target.value)
                    }}
                  />
                </div>
                {editError !== null && (
                  <p className='text-sm text-destructive' id={editErrorId}>
                    {editError}
                  </p>
                )}
              </div>

              <DialogFooter className='grid grid-cols-2 gap-2 sm:grid-cols-2 sm:justify-stretch'>
                <DialogClose
                  aria-label={`Cancel editing “${name}”`}
                  disabled={busyAction === 'edit'}
                  render={
                    <Button
                      className='w-full'
                      type='button'
                      variant='outline'
                    />
                  }
                >
                  Cancel
                </DialogClose>
                <Button
                  aria-label={`Save changes to “${name}”`}
                  className='w-full'
                  disabled={busyAction === 'edit'}
                  type='submit'
                >
                  {busyAction === 'edit' ? 'Saving…' : 'Save changes'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {canRecreate && (
          <Button
            aria-label={`Recreate “${name}” in Spotify`}
            className='order-1 col-span-2 w-full'
            disabled={isBusy}
            size='sm'
            onClick={() => void handleRecreate()}
          >
            {busyAction === 'recreate' ? 'Recreating…' : 'Recreate'}
          </Button>
        )}

        <AlertDialog open={isDeleteOpen} onOpenChange={handleDeleteOpenChange}>
          <AlertDialogTrigger
            render={
              <Button
                aria-label={`Delete “${name}”`}
                className='order-3 w-full'
                disabled={isBusy}
                size='sm'
                variant='destructive'
              />
            }
          >
            Delete
          </AlertDialogTrigger>
          <AlertDialogContent
            aria-describedby={`${deleteDescriptionId}${
              deleteError === null ? '' : ` ${deleteErrorId}`
            }`}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
              <AlertDialogDescription id={deleteDescriptionId}>
                {deleteDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError !== null && (
              <p className='text-sm text-destructive' id={deleteErrorId}>
                {deleteError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel
                aria-label={`Cancel deleting “${name}”`}
                disabled={busyAction === 'delete'}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                aria-label={`Delete “${name}”`}
                disabled={busyAction === 'delete'}
                variant='destructive'
                onClick={() => void handleDelete()}
              >
                {busyAction === 'delete' ? 'Deleting…' : 'Delete playlist'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {feedback !== null && (
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <p
            className={
              feedback.kind === 'error'
                ? 'text-destructive'
                : 'text-muted-foreground'
            }
          >
            {feedback.message}
          </p>
          {feedback.kind === 'reconnect' && (
            <Button
              aria-label={`Reconnect Spotify for “${name}”`}
              size='sm'
              onClick={() => void signInWithSpotify()}
            >
              Reconnect Spotify
            </Button>
          )}
        </div>
      )}

      <span className='sr-only' role='status'>
        {announcement}
      </span>
    </div>
  )
}
