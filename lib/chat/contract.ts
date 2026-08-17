// Client-safe chat/playlist contract. Pure narrowing over `unknown` (lib/json
// style) so 'use client' components can read tool outputs and the create-
// playlist response without importing any server module. The
// CreatePlaylistResponse type is imported type-only (erased at build), so no
// server code leaks into the client bundle.

import { isRecord, readNumber, readString, readStringArray } from '@/lib/json'
import { readPlaylistFailureResponse } from '@/lib/playlists/contract'
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

/**
 * What the UI needs from a `search_library` result. Parsed here rather than
 * inline in the renderer so the tool's output shape has exactly one client-side
 * reader — renaming a field in lib/chat/tools.ts then shows up as a type error
 * here instead of silently rendering "Found 0 matching songs".
 */
export interface SearchSummary {
  /** Full number of matches — the playlist-relevant figure. */
  matchCount: number
  unmatchedTagCount: number
}

/** One sampled candidate row as `search_library` reports it to the model. */
export interface SearchCandidate {
  songId: string
  title: string
  artists: string[]
  era: string | null
  energy: number | null
  tempoFeel: string | null
  genres: string[]
  moods: string[]
  durationMs: number | null
}

/**
 * The full `search_library` output shape. The tool's return value is checked
 * against this (`satisfies`), so renaming or dropping a field is a build error
 * rather than a silent "Found 0 matching songs" in the UI.
 */
export interface SearchResultContract {
  /** Full number of matches — the playlist-relevant figure. */
  matchCount: number
  /** Matches found by tag filters, before attribute post-filtering. */
  totalTagMatches: number
  scanned: number
  /** How many matches were sampled back to the model. */
  sampled: number
  truncated: boolean
  unmatchedTags: string[]
  candidates: SearchCandidate[]
  hint: string | undefined
}

export const readSearchSummary = (value: unknown): SearchSummary | null => {
  if (!isRecord(value)) return null
  const matchCount = readNumber(value.matchCount)
  if (matchCount === null) return null
  return {
    matchCount,
    unmatchedTagCount: Array.isArray(value.unmatchedTags)
      ? value.unmatchedTags.length
      : 0,
  }
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
  return readPlaylistFailureResponse(value)
}
