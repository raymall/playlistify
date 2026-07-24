// Client-safe chat/playlist contract. Pure narrowing over `unknown` (lib/json
// style) so 'use client' components can read tool outputs and the create-
// playlist response without importing any server module. The
// CreatePlaylistResponse type is imported type-only (erased at build), so no
// server code leaks into the client bundle.

import { isRecord, readNumber, readString } from '@/lib/json'
import type { CreatePlaylistResponse } from '@/lib/playlists/create'

export interface ProposalTrack {
  songId: string
  title: string
  artists: string[]
  albumArtUrl: string | null
  durationMs: number | null
  reason: string
}

export interface PlaylistProposal {
  name: string
  description: string
  tracks: ProposalTrack[]
}

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const str = readString(entry)
    if (str !== null) out.push(str)
  }
  return out
}

const readProposalTrack = (value: unknown): ProposalTrack | null => {
  if (!isRecord(value)) return null
  const songId = readString(value.songId)
  const title = readString(value.title)
  if (songId === null || title === null) return null
  return {
    songId,
    title,
    artists: readStringArray(value.artists),
    albumArtUrl: readString(value.albumArtUrl),
    durationMs: readNumber(value.durationMs),
    reason: readString(value.reason) ?? '',
  }
}

/**
 * Parse the `propose_playlist` tool output into a PlaylistProposal, or null
 * when it isn't a well-formed ok proposal. The preview panel narrows
 * `part.output` through this — never by importing the server tool.
 */
export const readPlaylistProposal = (
  value: unknown,
): PlaylistProposal | null => {
  if (!isRecord(value) || value.status !== 'ok') return null
  const name = readString(value.name)
  const description = readString(value.description)
  if (name === null || description === null) return null
  if (!Array.isArray(value.tracks)) return null
  const tracks: ProposalTrack[] = []
  for (const entry of value.tracks) {
    const track = readProposalTrack(entry)
    if (track !== null) tracks.push(track)
  }
  if (tracks.length === 0) return null
  return { name, description, tracks }
}

/** Parse the /api/playlists JSON body into the response contract, or null. */
export const readCreatePlaylistResponse = (
  value: unknown,
): CreatePlaylistResponse | null => {
  if (!isRecord(value)) return null
  const { status } = value
  if (status === 'created') {
    const spotifyPlaylistId = readString(value.spotifyPlaylistId)
    const spotifyUrl = readString(value.spotifyUrl)
    if (spotifyPlaylistId === null || spotifyUrl === null) return null
    return {
      status,
      playlistId: readString(value.playlistId),
      spotifyPlaylistId,
      spotifyUrl,
      persisted: value.persisted === true,
    }
  }
  if (status === 'partial') {
    const spotifyPlaylistId = readString(value.spotifyPlaylistId)
    const spotifyUrl = readString(value.spotifyUrl)
    const addedCount = readNumber(value.addedCount)
    const requestedCount = readNumber(value.requestedCount)
    if (
      spotifyPlaylistId === null ||
      spotifyUrl === null ||
      addedCount === null ||
      requestedCount === null
    ) {
      return null
    }
    return {
      status,
      spotifyPlaylistId,
      spotifyUrl,
      addedCount,
      requestedCount,
      persisted: value.persisted === true,
    }
  }
  if (status === 'reconnect_required') return { status }
  if (status === 'rate_limited') {
    const retryAfterSeconds = readNumber(value.retryAfterSeconds)
    if (retryAfterSeconds === null) return null
    return { status, retryAfterSeconds }
  }
  if (status === 'error') {
    return {
      status,
      message: readString(value.message) ?? 'Something went wrong.',
    }
  }
  return null
}
