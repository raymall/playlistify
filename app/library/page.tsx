import type { Metadata } from 'next'

import { LibraryEnrichmentPanel } from '@/components/library-enrichment-panel'
import { LibraryImportPanel } from '@/components/library-import-panel'
import { type LibrarySong, LibraryTable } from '@/components/library-table'
import { PageSection } from '@/components/page-section'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { readRecheckState } from '@/lib/enrichment/recheck'
import { readSongAIAttributes } from '@/lib/enrichment/schema'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Library',
}

const LIBRARY_PAGE_SIZE = 50

const firstOf = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>
}) {
  // Route protection lives in proxy.ts; RLS scopes every query below to the
  // signed-in user. No getUser() here: the proxy is the only place allowed to
  // refresh the token, because a server component can't persist the rotated
  // cookie and would consume the refresh token for nothing. The cookie the
  // proxy forwards is enough to authenticate the RLS queries.
  const supabase = await createClient()

  const params = await searchParams
  const query = (firstOf(params.q) ?? '').trim()
  const pageRaw = firstOf(params.page)
  const parsedPage = pageRaw === undefined ? 1 : Number.parseInt(pageRaw, 10)
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1

  const from = (page - 1) * LIBRARY_PAGE_SIZE
  const isSearching = query.length > 0

  // The user_genres/user_moods embeds return only the requester's rows because
  // this query runs on the RLS client — RLS is the only scoping. Ask for an
  // exact count only while searching: with no query the count equals the total
  // library size (fetched below), so a second full-count scan is pure waste.
  let request = supabase
    .from('user_songs')
    .select(
      `liked_at, songs!inner(
        id, title, artists, album_art_url, enrichment_status,
        ai_confidence, ai_attributes,
        song_genres(genre_id, genres(name)),
        song_moods(mood_id, moods(name)),
        user_genres(genre_id, genres(name)),
        user_moods(mood_id, moods(name)),
        user_genre_suppressions(genre_id, genres(name)),
        user_mood_suppressions(mood_id, moods(name))
      )`,
      isSearching ? { count: 'exact' } : undefined,
    )
    .order('liked_at', { ascending: false })

  if (isSearching) {
    // Escape PostgREST filter metacharacters. Search title + artists: the
    // artists_search generated column flattens the text[] so ilike can scan
    // it (a plain artists ilike can't).
    const sanitized = query.replace(/[,()%_\\]/g, ' ')
    request = request.or(
      `title.ilike.%${sanitized}%,artists_search.ilike.%${sanitized}%`,
      { referencedTable: 'songs' },
    )
  }

  // One parallel batch — the authoritative summary, row-level recheck states,
  // and the visible page. The summary shares its eligibility calculation with
  // the queue worker, so a terminal job cannot leave the button promising work
  // that the database will refuse to claim.
  const [countsResult, recheckStatesResult, rowsResult] = await Promise.all([
    supabase.rpc('library_enrichment_counts'),
    supabase.rpc('library_recheck_states'),
    request.range(from, from + LIBRARY_PAGE_SIZE - 1),
  ])

  const counts = countsResult.data?.at(0)
  const totalSongs = counts?.total ?? 0
  const recheckStateBySongId = new Map(
    (recheckStatesResult.data ?? []).flatMap((row) => {
      const state = readRecheckState(row.state)
      return state === null ? [] : [[row.song_id, state]]
    }),
  )
  // No search → the rows query carries no exact count, so the library total is
  // the count.
  const filteredCount = isSearching ? (rowsResult.count ?? 0) : totalSongs
  const rows: LibrarySong[] = (rowsResult.data ?? []).map((row) => ({
    id: row.songs.id,
    title: row.songs.title,
    artists: row.songs.artists,
    albumArtUrl: row.songs.album_art_url,
    enrichmentStatus: row.songs.enrichment_status,
    aiConfidence: row.songs.ai_confidence,
    aiAttributes: readSongAIAttributes(row.songs.ai_attributes),
    aiGenres: row.songs.song_genres.map((link) => ({
      id: link.genre_id,
      name: link.genres.name,
    })),
    aiMoods: row.songs.song_moods.map((link) => ({
      id: link.mood_id,
      name: link.moods.name,
    })),
    hiddenGenres: row.songs.user_genre_suppressions.map((link) => ({
      id: link.genre_id,
      name: link.genres.name,
    })),
    hiddenMoods: row.songs.user_mood_suppressions.map((link) => ({
      id: link.mood_id,
      name: link.moods.name,
    })),
    userGenres: row.songs.user_genres.map((link) => ({
      id: link.genre_id,
      name: link.genres.name,
    })),
    userMoods: row.songs.user_moods.map((link) => ({
      id: link.mood_id,
      name: link.moods.name,
    })),
    recheckState: recheckStateBySongId.get(row.songs.id) ?? null,
  }))

  const pageCount = Math.max(1, Math.ceil(filteredCount / LIBRARY_PAGE_SIZE))

  return (
    <PageSection>
      <header className='flex flex-col gap-1'>
        <h1 className='text-3xl font-semibold tracking-tight'>Library</h1>
        <p className='text-muted-foreground tabular-nums'>
          {totalSongs.toLocaleString()} songs
        </p>
      </header>

      <div className='mt-8'>
        <LibraryImportPanel hasLibrary={totalSongs > 0} />
        {totalSongs === 0 && (
          <p className='mt-3 max-w-prose text-sm text-muted-foreground'>
            Import your Spotify Liked Songs to build your library. Large
            libraries take a few minutes and the import resumes where it left
            off.
          </p>
        )}
        {totalSongs > 0 && (
          <LibraryEnrichmentPanel
            initialCounts={{
              total: totalSongs,
              pending: counts?.pending ?? 0,
              none: counts?.none ?? 0,
              low: counts?.low ?? 0,
              medium: counts?.medium ?? 0,
              high: counts?.high ?? 0,
              queued: counts?.queued ?? 0,
              ineligibleWeak: counts?.ineligible_weak ?? 0,
              eligible: counts?.eligible ?? 0,
            }}
          />
        )}
      </div>

      {totalSongs > 0 && (
        <div className='mt-10 flex flex-col gap-4'>
          <form
            action='/library'
            className='flex max-w-md items-center gap-2'
            role='search'
          >
            <Input
              aria-label='Search your library by title or artist'
              defaultValue={query}
              name='q'
              placeholder='Search title or artist'
              type='search'
            />
            <button
              className={buttonVariants({
                size: 'default',
                variant: 'outline',
              })}
              type='submit'
            >
              Search
            </button>
          </form>

          {rows.length > 0 ? (
            <>
              {query.length > 0 && (
                <p className='text-sm text-muted-foreground tabular-nums'>
                  {filteredCount.toLocaleString()} matching{' '}
                  {filteredCount === 1 ? 'song' : 'songs'}
                </p>
              )}
              <LibraryTable
                page={page}
                pageCount={pageCount}
                query={query}
                songs={rows}
              />
            </>
          ) : (
            <p className='text-sm text-muted-foreground'>
              No songs match “{query}”.
            </p>
          )}
        </div>
      )}
    </PageSection>
  )
}
