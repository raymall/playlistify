import Image from 'next/image'

import { LibraryConfidenceInfo } from '@/components/library-confidence-info'
import { LibraryRecheckAction } from '@/components/library-recheck-action'
import { LibraryTagEditor } from '@/components/library-tag-editor'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CONFIDENCE_BANDS,
  type ConfidenceBand,
  getConfidenceBand,
} from '@/lib/enrichment/confidence'
import {
  RECHECK_BUDGET_COPY,
  RECHECK_SHARED_RESULT_COPY,
} from '@/lib/enrichment/recheck'
import { type LibrarySong } from '@/lib/library/song'

const RECHECK_DESCRIPTION_ID = 'library-recheck-description'

type LibraryTableProps = {
  activeBands: ConfidenceBand[]
  activeGenres: string[]
  activeMoods: string[]
  songs: LibrarySong[]
}

/**
 * Visual weight tracks band strength, but the badge always carries its label
 * as text — the band is never conveyed by appearance alone.
 */
const confidenceVariant: Record<
  ConfidenceBand,
  'default' | 'secondary' | 'outline' | 'ghost'
> = {
  pending: 'ghost',
  none: 'outline',
  low: 'outline',
  medium: 'secondary',
  high: 'default',
}

type LibraryTagChipsProps = {
  activeGenres: Set<string>
  activeMoods: Set<string>
  song: LibrarySong
}

/**
 * AI tags (filled) and the user's own tags (outlined) — variant is the
 * distinction, never hue, per the monochrome theme. A chip matching an active
 * filter is promoted to the strongest variant and says so in text, which
 * answers "why did this row match?" without relying on appearance.
 */
const LibraryTagChips = ({
  activeGenres,
  activeMoods,
  song,
}: LibraryTagChipsProps) => {
  const hiddenGenreIds = new Set(song.hiddenGenres.map((tag) => tag.id))
  const hiddenMoodIds = new Set(song.hiddenMoods.map((tag) => tag.id))
  const aiGenres = song.aiGenres.filter((tag) => !hiddenGenreIds.has(tag.id))
  const aiMoods = song.aiMoods.filter((tag) => !hiddenMoodIds.has(tag.id))
  const hasTags =
    aiGenres.length > 0 ||
    aiMoods.length > 0 ||
    song.userGenres.length > 0 ||
    song.userMoods.length > 0

  if (!hasTags) {
    return <span className='text-sm text-muted-foreground'>—</span>
  }

  const renderChip = (
    key: string,
    prefix: string,
    name: string,
    isActive: boolean,
    inactiveVariant: 'secondary' | 'outline',
  ) => (
    <Badge key={key} variant={isActive ? 'default' : inactiveVariant}>
      <span className='sr-only'>{prefix}</span>
      {name}
      {isActive && <span className='sr-only'> (active filter)</span>}
    </Badge>
  )

  return (
    <div className='flex flex-wrap items-center gap-1'>
      {aiGenres.map((tag) =>
        renderChip(
          `ai-genre-${tag.id}`,
          'AI genre: ',
          tag.name,
          activeGenres.has(tag.name),
          'secondary',
        ),
      )}
      {aiMoods.map((tag) =>
        renderChip(
          `ai-mood-${tag.id}`,
          'AI mood: ',
          tag.name,
          activeMoods.has(tag.name),
          'secondary',
        ),
      )}
      {song.userGenres.map((tag) =>
        renderChip(
          `user-genre-${tag.id}`,
          'Your genre: ',
          tag.name,
          activeGenres.has(tag.name),
          'outline',
        ),
      )}
      {song.userMoods.map((tag) =>
        renderChip(
          `user-mood-${tag.id}`,
          'Your mood: ',
          tag.name,
          activeMoods.has(tag.name),
          'outline',
        ),
      )}
    </div>
  )
}

export const LibraryTable = ({
  activeBands,
  activeGenres,
  activeMoods,
  songs,
}: LibraryTableProps) => {
  const activeGenreNames = new Set(activeGenres)
  const activeMoodNames = new Set(activeMoods)
  const activeBandSet = new Set(activeBands)

  return (
    <div>
      {/* One description for every row button. A per-row popover would add a
          focusable trigger to all 50 rows, which already carry a tag editor. */}
      <p className='sr-only' id={RECHECK_DESCRIPTION_ID}>
        {RECHECK_SHARED_RESULT_COPY} {RECHECK_BUDGET_COPY}
      </p>
      <Table className='table-fixed'>
        <TableCaption className='sr-only'>
          Your imported Liked Songs, most recently liked first
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className='w-16' scope='col'>
              <span className='sr-only'>Artwork</span>
            </TableHead>
            <TableHead scope='col'>Title</TableHead>
            <TableHead scope='col'>Artists</TableHead>
            <TableHead className='w-2/5' scope='col'>
              Tags
            </TableHead>
            <TableHead className='w-32 text-right' scope='col'>
              <span className='inline-flex items-center gap-1'>
                Confidence
                <LibraryConfidenceInfo />
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {songs.map((song) => {
            const titleText = song.title ?? 'Untitled'
            const artistsText =
              song.artists !== null && song.artists.length > 0
                ? song.artists.join(', ')
                : '—'
            const confidenceBand = getConfidenceBand(
              song.enrichmentStatus,
              song.aiConfidence,
            )
            return (
              <TableRow key={song.id}>
                <TableCell>
                  {song.albumArtUrl !== null ? (
                    <Image
                      alt=''
                      className='size-10 object-cover'
                      height={40}
                      src={song.albumArtUrl}
                      width={40}
                    />
                  ) : (
                    <div aria-hidden='true' className='size-10 bg-muted' />
                  )}
                </TableCell>
                {/* The row's header cell, so "Re-analyze" in the last column
                    is announced against a song name rather than a bare row. */}
                <th
                  className='p-2 text-left align-middle font-medium whitespace-nowrap text-foreground'
                  scope='row'
                >
                  <span
                    className='block truncate'
                    title={song.title ?? undefined}
                  >
                    {titleText}
                  </span>
                </th>
                <TableCell className='text-muted-foreground'>
                  <span
                    className='block truncate'
                    title={artistsText === '—' ? undefined : artistsText}
                  >
                    {artistsText}
                  </span>
                </TableCell>
                <TableCell>
                  <div className='flex items-start gap-1'>
                    <div className='min-w-0 flex-1'>
                      <LibraryTagChips
                        activeGenres={activeGenreNames}
                        activeMoods={activeMoodNames}
                        song={song}
                      />
                    </div>
                    <LibraryTagEditor
                      aiAttributes={song.aiAttributes}
                      aiConfidence={song.aiConfidence}
                      aiGenres={song.aiGenres}
                      aiMoods={song.aiMoods}
                      hiddenGenres={song.hiddenGenres}
                      hiddenMoods={song.hiddenMoods}
                      songId={song.id}
                      songTitle={titleText}
                      userGenres={song.userGenres}
                      userMoods={song.userMoods}
                    />
                  </div>
                </TableCell>
                <TableCell className='text-right'>
                  <Badge
                    variant={
                      activeBandSet.has(confidenceBand)
                        ? 'default'
                        : confidenceVariant[confidenceBand]
                    }
                  >
                    {CONFIDENCE_BANDS[confidenceBand].label}
                    {activeBandSet.has(confidenceBand) && (
                      <span className='sr-only'> (active filter)</span>
                    )}
                  </Badge>
                  {song.recheckState !== null && (
                    <LibraryRecheckAction
                      describedById={RECHECK_DESCRIPTION_ID}
                      initialAttemptsRemaining={song.recheckAttemptsRemaining}
                      initialState={song.recheckState}
                      isPending={confidenceBand === 'pending'}
                      songId={song.id}
                      songTitle={titleText}
                    />
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
