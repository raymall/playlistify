// The /library URL is the only source of truth for search state: free text in
// `q`, filter pills as repeated `genre` / `mood` params, and `page`.
//
// Tag names, not ids: genres.name / moods.name are UNIQUE NOT NULL and already
// normalized by normalizeTagName, so the name is the natural key. That keeps
// the URL legible and hand-editable, and the pill components never carry a
// parallel id. Repeated params rather than a packed `genre=rock,jazz` because
// tag names are user-authored — any separator would be a real escaping bug.
//
// Pure and isomorphic (no 'use client', no next/server): the server component
// parses, the search bar rebuilds, both from this module.

import { type TagKind } from '@/lib/tags'
import { MAX_TAG_LENGTH, normalizeTagName } from '@/lib/vocabulary'

export const LIBRARY_PAGE_SIZE = 50

/** Per kind, so 12 genres and 12 moods can coexist. */
export const MAX_LIBRARY_TAG_FILTERS = 12

/** pg_trgm extracts nothing from a run shorter than this. */
export const MIN_TAG_QUERY_LENGTH = 3

/** Bounds a hand-edited `?q=`; search.ts caps the term count separately. */
const MAX_QUERY_LENGTH = 120

/** Bounds a hand-edited `?page=` so the offset stays sane. */
const MAX_PAGE = 100_000

export type LibraryTagFilter = {
  kind: TagKind
  name: string
}

export type LibrarySearchState = {
  query: string
  genres: string[]
  moods: string[]
  page: number
}

/** The shape Next.js resolves `searchParams` to. */
export type LibrarySearchParams = Record<string, string | string[] | undefined>

const toValues = (raw: string | string[] | undefined): string[] => {
  if (raw === undefined) return []
  return Array.isArray(raw) ? raw : [raw]
}

const parseQuery = (raw: string | string[] | undefined): string =>
  (toValues(raw).at(0) ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_QUERY_LENGTH)

/**
 * Normalize → drop empty/oversized → dedupe → sort → cap. Sorting is what makes
 * `?genre=rock&genre=jazz` and its reverse produce one href, so prefetch and
 * history don't fragment over an ordering the user never chose.
 */
const parseNames = (raw: string | string[] | undefined): string[] => {
  const names = new Set<string>()
  for (const value of toValues(raw)) {
    const name = normalizeTagName(value)
    if (name.length === 0 || name.length > MAX_TAG_LENGTH) continue
    names.add(name)
  }
  return [...names].sort().slice(0, MAX_LIBRARY_TAG_FILTERS)
}

const parsePage = (raw: string | string[] | undefined): number => {
  const page = Number.parseInt(toValues(raw).at(0) ?? '', 10)
  if (!Number.isFinite(page) || page < 1) return 1
  return Math.min(page, MAX_PAGE)
}

export const parseLibrarySearchParams = (
  params: LibrarySearchParams,
): LibrarySearchState => ({
  query: parseQuery(params.q),
  genres: parseNames(params.genre),
  moods: parseNames(params.mood),
  page: parsePage(params.page),
})

export const buildLibraryHref = (state: LibrarySearchState): string => {
  const params = new URLSearchParams()
  if (state.query.length > 0) params.set('q', state.query)
  for (const name of state.genres) params.append('genre', name)
  for (const name of state.moods) params.append('mood', name)
  if (state.page > 1) params.set('page', String(state.page))
  const search = params.toString()
  return search.length > 0 ? `/library?${search}` : '/library'
}

/**
 * The only transition that keeps the page. Everything else resets to 1, which
 * is what kills the "page 7 of a 2-page result" class of bug outright.
 */
export const withLibraryPage = (
  state: LibrarySearchState,
  page: number,
): LibrarySearchState => ({
  ...state,
  page: Math.min(Math.max(Math.trunc(page), 1), MAX_PAGE),
})

export const withLibraryQuery = (
  state: LibrarySearchState,
  query: string,
): LibrarySearchState => ({
  ...state,
  query: parseQuery(query),
  page: 1,
})

export const withLibraryFilter = (
  state: LibrarySearchState,
  filter: LibraryTagFilter,
): LibrarySearchState => {
  const current = filter.kind === 'genre' ? state.genres : state.moods
  const next = [...new Set([...current, filter.name])]
    .sort()
    .slice(0, MAX_LIBRARY_TAG_FILTERS)
  return {
    ...state,
    genres: filter.kind === 'genre' ? next : state.genres,
    moods: filter.kind === 'mood' ? next : state.moods,
    page: 1,
  }
}

export const withoutLibraryFilter = (
  state: LibrarySearchState,
  filter: LibraryTagFilter,
): LibrarySearchState => {
  const drop = (names: string[]) => names.filter((name) => name !== filter.name)
  return {
    ...state,
    genres: filter.kind === 'genre' ? drop(state.genres) : state.genres,
    moods: filter.kind === 'mood' ? drop(state.moods) : state.moods,
    page: 1,
  }
}

/** Back to a bare /library — text, pills, and page all dropped. */
export const clearLibraryFilters = (): LibrarySearchState => ({
  query: '',
  genres: [],
  moods: [],
  page: 1,
})

export const countLibraryFilters = (state: LibrarySearchState): number =>
  state.genres.length + state.moods.length

/** Ordered pills, genres first — the order chips and copy both follow. */
export const listLibraryFilters = (
  state: LibrarySearchState,
): LibraryTagFilter[] => [
  ...state.genres.map((name) => ({ kind: 'genre' as const, name })),
  ...state.moods.map((name) => ({ kind: 'mood' as const, name })),
]

/**
 * "genre britpop and mood melancholy" — one phrasing shared by the empty-state
 * copy and the live region, so the two can't drift.
 */
export const describeLibraryFilters = (state: LibrarySearchState): string => {
  const parts = listLibraryFilters(state).map(
    (filter) => `${filter.kind} ${filter.name}`,
  )
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
