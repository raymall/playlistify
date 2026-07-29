import type { Metadata } from 'next'

import {
  type EnrichmentModelOption,
  LibraryEnrichmentPanel,
} from '@/components/library-enrichment-panel'
import { LibraryImportPanel } from '@/components/library-import-panel'
import { type LibrarySong, LibraryTable } from '@/components/library-table'
import { PageSection } from '@/components/page-section'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getDefaultModel, getEnabledModels } from '@/lib/ai/models'
import { filterMappedModels } from '@/lib/ai/providers'
import { IMPROVABLE_SONGS_FILTER } from '@/lib/enrichment/accuracy'
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
  // signed-in user. We deliberately don't call getUser() here — doing so in a
  // server component triggers a second token refresh that races the one the
  // proxy just performed, and a consumed refresh token bounces a valid session.
  // The cookie the proxy forwards is enough to authenticate the RLS queries.
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
        song_genres(genres(name)),
        song_moods(moods(name)),
        user_genres(genre_id, genres(name)),
        user_moods(mood_id, moods(name))
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

  // One parallel batch — the whole page's data in a single round-trip stage.
  // Folding the total count in here (rather than awaiting it first) removes a
  // sequential round trip. These run for an empty library too, returning 0/[]
  // that the totalSongs-gated JSX below simply doesn't render.
  const [
    libraryResult,
    pendingResult,
    improvableResult,
    enabledModels,
    rowsResult,
  ] = await Promise.all([
    // Total library size (unfiltered) drives the header + the panel's button
    // label; RLS scopes it to this user.
    supabase
      .from('user_songs')
      .select('song_id', { count: 'exact', head: true }),
    supabase
      .from('user_songs')
      .select('song_id, songs!inner(enrichment_status)', {
        count: 'exact',
        head: true,
      })
      .eq('songs.enrichment_status', 'pending'),
    // None/Low rows a strong enough model could redo. Deliberately not
    // rank-filtered: the model isn't chosen until the client renders, so this
    // is the model-independent ceiling. The engine narrows it to the selected
    // model per batch.
    supabase
      .from('user_songs')
      .select('song_id, songs!inner(enrichment_status, ai_confidence)', {
        count: 'exact',
        head: true,
      })
      .or(IMPROVABLE_SONGS_FILTER, { referencedTable: 'songs' }),
    getEnabledModels(supabase),
    request.range(from, from + LIBRARY_PAGE_SIZE - 1),
  ])

  const totalSongs = libraryResult.count ?? 0
  const pendingSongs = pendingResult.count ?? 0
  const improvableSongs = improvableResult.count ?? 0

  // Null = catalog query failed; render the "no models" state rather than
  // crashing the page — the enrich route re-checks with its own error.
  const mappedModels = filterMappedModels(enabledModels ?? [])
  const modelOptions: EnrichmentModelOption[] = mappedModels.map((model) => ({
    id: model.id,
    label: model.label,
  }))
  const defaultModelId = getDefaultModel(mappedModels)?.id ?? null

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
    aiGenres: row.songs.song_genres.map((link) => link.genres.name),
    aiMoods: row.songs.song_moods.map((link) => link.moods.name),
    userGenres: row.songs.user_genres.map((link) => ({
      id: link.genre_id,
      name: link.genres.name,
    })),
    userMoods: row.songs.user_moods.map((link) => ({
      id: link.mood_id,
      name: link.moods.name,
    })),
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
            defaultModelId={defaultModelId}
            improvableCount={improvableSongs}
            models={modelOptions}
            pendingCount={pendingSongs}
            totalCount={totalSongs}
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
