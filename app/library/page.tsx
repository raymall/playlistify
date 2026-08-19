import type { Metadata } from 'next'
import { Suspense } from 'react'

import { LibraryEnrichmentPanel } from '@/components/library-enrichment-panel'
import { LibraryImportPanel } from '@/components/library-import-panel'
import { LibraryResults } from '@/components/library-results'
import { LibrarySearchBar } from '@/components/library-search-bar'
import { LibraryTableSkeleton } from '@/components/library-table-skeleton'
import { PageSection } from '@/components/page-section'
import { getLibraryEnrichmentRecipes } from '@/lib/enrichment/recipes'
import {
  buildLibraryHref,
  type LibrarySearchParams,
  parseLibrarySearchParams,
} from '@/lib/library/search-params'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Library',
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<LibrarySearchParams>
}) {
  // Route protection lives in proxy.ts; RLS scopes every query below to the
  // signed-in user. No getUser() here: the proxy is the only place allowed to
  // refresh the token, because a server component can't persist the rotated
  // cookie and would consume the refresh token for nothing. The cookie the
  // proxy forwards is enough to authenticate the RLS queries.
  const supabase = await createClient()
  const state = parseLibrarySearchParams(await searchParams)

  // Only the authoritative summary blocks this component. The search itself
  // runs inside the boundary below, so the panels paint immediately and an
  // in-flight import or enrichment survives every search navigation.
  const [countsResult, recipes] = await Promise.all([
    supabase.rpc('library_enrichment_counts'),
    getLibraryEnrichmentRecipes(supabase),
  ])
  const counts = countsResult.data?.at(0)
  const totalSongs = counts?.total ?? 0

  return (
    <PageSection>
      <header className='flex flex-col gap-6 border-b-2 border-border pb-8 sm:flex-row sm:items-end sm:justify-between'>
        <div className='flex flex-col gap-4'>
          <p className='editorial-kicker'>01 / Liked Songs</p>
          <h1 className='editorial-title'>Library</h1>
        </div>
        <LibraryImportPanel hasLibrary={totalSongs > 0} />
      </header>

      {totalSongs === 0 && (
        <p className='mt-8 max-w-prose text-sm text-muted-foreground'>
          Import your Spotify Liked Songs to build your library. Large libraries
          take a few minutes and the import resumes where it left off.
        </p>
      )}

      {totalSongs > 0 && (
        <div className='mt-8 flex flex-col gap-8'>
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
            recipes={recipes}
          />
          <LibrarySearchBar state={state} />
          {/* A changed key mounts a *new* boundary, which is never "already
              revealed" — without it React would not revert the revealed
              fallback during a transition and a search would look frozen. */}
          <Suspense
            key={buildLibraryHref(state)}
            fallback={<LibraryTableSkeleton />}
          >
            <LibraryResults state={state} totalSongs={totalSongs} />
          </Suspense>
        </div>
      )}
    </PageSection>
  )
}
