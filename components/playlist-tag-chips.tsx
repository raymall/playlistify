import { Badge } from '@/components/ui/badge'

export type PlaylistTagSummary = {
  kind: 'ai_genre' | 'ai_mood' | 'personal_genre' | 'personal_mood'
  name: string
  songCount: number
}

type PlaylistTagChipsProps = {
  tags: PlaylistTagSummary[]
}

const GENRE_LIMIT = 6
const MOOD_LIMIT = 4

const bySongCount = (left: PlaylistTagSummary, right: PlaylistTagSummary) =>
  right.songCount - left.songCount || left.name.localeCompare(right.name)

type TagGroupProps = {
  label: 'Genre' | 'Mood'
  limit: number
  tags: PlaylistTagSummary[]
}

const TagGroup = ({ label, limit, tags }: TagGroupProps) => {
  const sorted = tags.toSorted(bySongCount)
  const visible = sorted.slice(0, limit)
  const hiddenCount = sorted.length - visible.length

  return (
    <div className='flex flex-wrap items-center gap-1'>
      {visible.map((tag) => {
        const isPersonal = tag.kind.startsWith('personal_')
        return (
          <Badge
            key={`${tag.kind}-${tag.name}`}
            variant={isPersonal ? 'outline' : 'secondary'}
          >
            <span className='sr-only'>
              {label}: {isPersonal ? 'Personal tag, ' : 'AI tag, '}
            </span>
            {tag.name}
          </Badge>
        )
      })}
      {hiddenCount > 0 && (
        <span className='text-xs text-muted-foreground'>
          +{hiddenCount.toLocaleString()} more
        </span>
      )}
    </div>
  )
}

/** Effective AI and personal tags, capped only after the database rollup. */
export const PlaylistTagChips = ({ tags }: PlaylistTagChipsProps) => {
  const genres = tags.filter((tag) => tag.kind.endsWith('genre'))
  const moods = tags.filter((tag) => tag.kind.endsWith('mood'))

  if (genres.length === 0 && moods.length === 0) {
    return <span className='text-sm text-muted-foreground'>—</span>
  }

  return (
    <div className='flex flex-col gap-2'>
      {genres.length > 0 && (
        <TagGroup label='Genre' limit={GENRE_LIMIT} tags={genres} />
      )}
      {moods.length > 0 && (
        <TagGroup label='Mood' limit={MOOD_LIMIT} tags={moods} />
      )}
    </div>
  )
}
