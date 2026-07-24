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

  // Total library size (unfiltered) drives the header + the panel's button
  // label; RLS scopes it to this user.
  const { count: libraryCount } = await supabase
    .from('user_songs')
    .select('song_id', { count: 'exact', head: true })
  const totalSongs = libraryCount ?? 0

  // Enrichment inputs: how many songs still need enriching, and which catalog
  // models this build can actually run. The panel gets plain id/label rows —
  // provider internals stay server-side.
  let pendingSongs = 0
  let modelOptions: EnrichmentModelOption[] = []
  let defaultModelId: string | null = null
  let rows: LibrarySong[] = []
  let filteredCount = 0

  if (totalSongs > 0) {
    // The user_genres/user_moods embeds return only the requester's rows
    // because this query runs on the RLS client — RLS is the only scoping.
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
        { count: 'exact' },
      )
      .order('liked_at', { ascending: false })

    if (query.length > 0) {
      // Escape PostgREST filter metacharacters. Search title + artists: the
      // artists_search generated column flattens the text[] so ilike can scan
      // it (a plain artists ilike can't).
      const sanitized = query.replace(/[,()%_\\]/g, ' ')
      request = request.or(
        `title.ilike.%${sanitized}%,artists_search.ilike.%${sanitized}%`,
        { referencedTable: 'songs' },
      )
    }

    const from = (page - 1) * LIBRARY_PAGE_SIZE
    const [pendingResult, enabledModels, rowsResult] = await Promise.all([
      supabase
        .from('user_songs')
        .select('song_id, songs!inner(enrichment_status)', {
          count: 'exact',
          head: true,
        })
        .eq('songs.enrichment_status', 'pending'),
      getEnabledModels(supabase),
      request.range(from, from + LIBRARY_PAGE_SIZE - 1),
    ])

    pendingSongs = pendingResult.count ?? 0
    // Null = catalog query failed; render the "no models" state rather than
    // crashing the page — the enrich route re-checks with its own error.
    const mappedModels = filterMappedModels(enabledModels ?? [])
    modelOptions = mappedModels.map((model) => ({
      id: model.id,
      label: model.label,
    }))
    defaultModelId = getDefaultModel(mappedModels)?.id ?? null

    filteredCount = rowsResult.count ?? 0
    rows = (rowsResult.data ?? []).map((row) => ({
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
  }

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
