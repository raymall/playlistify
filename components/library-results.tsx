import Link from 'next/link'

import { LibraryPagination } from '@/components/library-pagination'
import { LibraryTable } from '@/components/library-table'
import { buttonVariants } from '@/components/ui/button'
import { searchLibrary } from '@/lib/library/search'
import {
  countLibraryFilters,
  describeLibraryFilters,
  type LibrarySearchState,
  withLibraryPage,
} from '@/lib/library/search-params'
import { createClient } from '@/lib/supabase/server'

type LibraryResultsProps = {
  state: LibrarySearchState
  totalSongs: number
}

const buildEmptyMessage = (state: LibrarySearchState): string => {
  const filters = describeLibraryFilters(state)
  const hasQuery = state.query.length > 0
  const hasTags = state.genres.length + state.moods.length > 0
  if (hasQuery && filters.length > 0) {
    return `No songs match “${state.query}” and ${filters}.`
  }
  if (hasQuery) {
    return `No songs match “${state.query}”. Try fewer words or a different spelling.`
  }
  // "all of these tags" only holds while tags are the whole filter — a band
  // widens rather than narrows, so a mixed set gets the neutral phrasing.
  if (hasTags && state.bands.length === 0) {
    return `No songs have all of these tags: ${filters}.`
  }
  if (filters.length > 0) return `No songs match ${filters}.`
  return 'No songs to show.'
}

/**
 * The only part of /library that suspends. Everything above it — the header,
 * the import panel, the enrichment panel, the search bar and its typed text —
 * survives a search or page change untouched.
 */
export const LibraryResults = async ({
  state,
  totalSongs,
}: LibraryResultsProps) => {
  const supabase = await createClient()

  // The count rides on the result rows, so an out-of-range offset returns no
  // rows and no count. Re-query at page 1 rather than redirect(): once the
  // stream has started the status code is already fixed.
  let effectiveState = state
  let result = await searchLibrary(supabase, state, totalSongs)
  let hasOverflowed = false
  if (result.songs.length === 0 && state.page > 1) {
    effectiveState = withLibraryPage(state, 1)
    result = await searchLibrary(supabase, effectiveState, totalSongs)
    hasOverflowed = true
  }

  const hasFilters =
    effectiveState.query.length > 0 || countLibraryFilters(effectiveState) > 0
  const hasResults = result.songs.length > 0
  const canClear = countLibraryFilters(effectiveState) > 0
  const summary = !hasResults
    ? buildEmptyMessage(effectiveState)
    : hasFilters
      ? `${result.filteredCount.toLocaleString()} matching ${
          result.filteredCount === 1 ? 'song' : 'songs'
        }`
      : ''

  return (
    <div className='flex flex-col gap-4'>
      {hasOverflowed && (
        <p className='text-sm text-muted-foreground' role='status'>
          Page {state.page} doesn’t exist — showing the first page.
        </p>
      )}

      {/* Always mounted: swapping this paragraph's children announces, while
          replacing the paragraph itself would unmount the region silently. */}
      <p
        aria-live='polite'
        className='text-sm text-muted-foreground tabular-nums'
        role='status'
      >
        {summary}
      </p>

      {hasResults ? (
        <div>
          <LibraryTable
            activeBands={effectiveState.bands}
            activeGenres={effectiveState.genres}
            activeMoods={effectiveState.moods}
            songs={result.songs}
          />
          <LibraryPagination
            page={effectiveState.page}
            pageCount={result.pageCount}
            state={effectiveState}
          />
        </div>
      ) : (
        canClear && (
          <div>
            <Link
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              href='/library'
            >
              Clear all filters
            </Link>
          </div>
        )
      )}
    </div>
  )
}
