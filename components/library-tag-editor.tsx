'use client'

import { TagsIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
} from '@/components/ui/combobox'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { type SongAIAttributes } from '@/lib/enrichment/schema'
import { isRecord, readString } from '@/lib/json'
import { MIN_TAG_QUERY_LENGTH } from '@/lib/library/search-params'
import { type LibraryTag } from '@/lib/library/song'
import { useTagSuggestions } from '@/lib/library/use-tag-suggestions'
import {
  type TagAddResponse,
  type TagKind,
  type TagRemoveResponse,
} from '@/lib/tags'
import { cn } from '@/lib/utils'
import { isValidTagName, normalizeTagName } from '@/lib/vocabulary'

type LibraryTagEditorProps = {
  aiConfidence: number | null
  aiAttributes: SongAIAttributes | null
  aiGenres: LibraryTag[]
  aiMoods: LibraryTag[]
  hiddenGenres: LibraryTag[]
  hiddenMoods: LibraryTag[]
  isCurrentRecipe: boolean
  recipeLabel: string | null
  songId: string
  songTitle: string
  userGenres: LibraryTag[]
  userMoods: LibraryTag[]
}

const parseAddResponse = (value: unknown): TagAddResponse | null => {
  if (!isRecord(value)) return null
  const { status } = value
  if (status === 'ok') {
    if (!isRecord(value.tag)) return null
    const id = readString(value.tag.id)
    const name = readString(value.tag.name)
    if (id === null || name === null) return null
    return { status, tag: { id, name } }
  }
  if (status === 'error') {
    return {
      status,
      message: readString(value.message) ?? 'Something went wrong.',
    }
  }
  return null
}

const parseRemoveResponse = (value: unknown): TagRemoveResponse | null => {
  if (!isRecord(value)) return null
  const { status } = value
  if (status === 'ok') return { status }
  if (status === 'error') {
    return {
      status,
      message: readString(value.message) ?? 'Something went wrong.',
    }
  }
  return null
}

const formatAttributesLine = (
  attributes: SongAIAttributes,
  confidence: number | null,
): string => {
  const parts = [`Energy ${attributes.energy}/5`, attributes.tempo_feel]
  if (attributes.era.length > 0) parts.push(attributes.era)
  if (confidence !== null) parts.push(`confidence ${confidence.toFixed(2)}`)
  return parts.join(' · ')
}

type TagKindEditorProps = {
  kind: TagKind
  label: string
  placeholder: string
  selected: LibraryTag[]
  songTitle: string
  onValueChange: (next: string[]) => void
}

/**
 * One independently floating combobox per tag kind, over the same debounced
 * typeahead the library filter bar uses. Suggestions are a convenience, not a
 * gate: free entry works by injecting the normalized query as the first item
 * when it isn't among the matches, and the write path saves whatever the user
 * typed. A name that already exists resolves to that row; anything else
 * becomes a new one.
 */
const TagKindEditor = ({
  kind,
  label,
  placeholder,
  selected,
  songTitle,
  onValueChange,
}: TagKindEditorProps) => {
  const labelId = useId()
  const [inputValue, setInputValue] = useState('')
  const suggestions = useTagSuggestions(inputValue)

  const selectedNames = selected.map((tag) => tag.name)
  const query = normalizeTagName(inputValue)
  const matches =
    suggestions.status === 'ready'
      ? suggestions.suggestions
          .filter((suggestion) => suggestion.kind === kind)
          .map((suggestion) => suggestion.name)
      : []
  const isCreatable = isValidTagName(query) && !matches.includes(query)
  const items = isCreatable ? [query, ...matches] : matches

  const statusMessage = (() => {
    if (query.length === 0) return ''
    if (query.length < MIN_TAG_QUERY_LENGTH) {
      return `Type ${MIN_TAG_QUERY_LENGTH} letters to see suggestions.`
    }
    if (suggestions.status === 'loading') return 'Loading suggestions…'
    if (suggestions.status === 'unavailable') {
      return 'Suggestions are unavailable. Free entry still works.'
    }
    return ''
  })()

  return (
    <Combobox
      multiple
      filter={null}
      items={items}
      value={selectedNames}
      onInputValueChange={(value) => {
        setInputValue(value)
      }}
      onValueChange={onValueChange}
    >
      <div className='flex flex-col gap-1.5'>
        <span
          className='text-xs font-medium text-muted-foreground'
          id={labelId}
        >
          {label}
        </span>
        <ComboboxChips>
          {selected.map((tag) => (
            <ComboboxChip key={tag.id}>
              {tag.name}
              <ComboboxChipRemove
                aria-label={`Remove ${kind} ${tag.name} from ${songTitle}`}
              />
            </ComboboxChip>
          ))}
          <ComboboxInput aria-labelledby={labelId} placeholder={placeholder} />
        </ComboboxChips>
      </div>
      <ComboboxPortal>
        <ComboboxPositioner>
          <ComboboxPopup>
            <ComboboxStatus>{statusMessage}</ComboboxStatus>
            <ComboboxList className='border-0'>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {isCreatable && item === query ? `Create "${item}"` : item}
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>Type to add your own {kind}.</ComboboxEmpty>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  )
}

/**
 * Per-row personal tag editor: a popover holding the song's AI attribute
 * summary and one creatable multi-select combobox per tag kind. Mutations go
 * through /api/tags one at a time (a promise queue serializes rapid changes)
 * and local state updates only from the server's response; closing the
 * editor refreshes the server-rendered chips.
 */
export const LibraryTagEditor = ({
  aiConfidence,
  aiAttributes,
  aiGenres,
  aiMoods,
  hiddenGenres,
  hiddenMoods,
  isCurrentRecipe,
  recipeLabel,
  songId,
  songTitle,
  userGenres,
  userMoods,
}: LibraryTagEditorProps) => {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [genres, setGenres] = useState(userGenres)
  const [moods, setMoods] = useState(userMoods)
  const [hiddenAiGenres, setHiddenAiGenres] = useState(hiddenGenres)
  const [hiddenAiMoods, setHiddenAiMoods] = useState(hiddenMoods)
  const [isShowingHidden, setIsShowingHidden] = useState(false)
  const [prevUserGenres, setPrevUserGenres] = useState(userGenres)
  const [prevUserMoods, setPrevUserMoods] = useState(userMoods)
  const [prevHiddenGenres, setPrevHiddenGenres] = useState(hiddenGenres)
  const [prevHiddenMoods, setPrevHiddenMoods] = useState(hiddenMoods)
  const [announcement, setAnnouncement] = useState('')
  const isActiveRef = useRef(true)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const hasChangedRef = useRef(false)

  useEffect(() => {
    isActiveRef.current = true
    return () => {
      isActiveRef.current = false
    }
  }, [])

  // router.refresh() lands new server truth in these props (which already
  // includes every awaited write); resync the local echo during render, per
  // the React "adjusting state when props change" pattern.
  if (prevUserGenres !== userGenres) {
    setPrevUserGenres(userGenres)
    setGenres(userGenres)
  }
  if (prevUserMoods !== userMoods) {
    setPrevUserMoods(userMoods)
    setMoods(userMoods)
  }
  if (prevHiddenGenres !== hiddenGenres) {
    setPrevHiddenGenres(hiddenGenres)
    setHiddenAiGenres(hiddenGenres)
  }
  if (prevHiddenMoods !== hiddenMoods) {
    setPrevHiddenMoods(hiddenMoods)
    setHiddenAiMoods(hiddenMoods)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen)
    if (nextOpen) return
    if (hasChangedRef.current) {
      hasChangedRef.current = false
      router.refresh()
    }
  }

  const enqueue = (run: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(run)
  }

  const requestJson = async (
    method: 'POST' | 'DELETE',
    body: unknown,
  ): Promise<unknown> => {
    try {
      const response = await fetch('/api/tags', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await response.json()
    } catch {
      return null
    }
  }

  const addTag = (kind: TagKind, name: string) => {
    enqueue(async () => {
      const payload = await requestJson('POST', {
        operation: 'add',
        songId,
        kind,
        name,
      })
      if (!isActiveRef.current) return
      const parsed = parseAddResponse(payload)
      if (parsed === null || parsed.status === 'error') {
        setAnnouncement(`The ${kind} could not be added.`)
        return
      }
      hasChangedRef.current = true
      const { tag } = parsed
      const append = (current: LibraryTag[]) =>
        current.some((existing) => existing.id === tag.id)
          ? current
          : [...current, tag]
      if (kind === 'genre') setGenres(append)
      else setMoods(append)
      setAnnouncement(`Added ${kind} ${tag.name}.`)
    })
  }

  const removeTag = (kind: TagKind, tag: LibraryTag) => {
    enqueue(async () => {
      const payload = await requestJson('DELETE', {
        operation: 'remove',
        songId,
        kind,
        tagId: tag.id,
      })
      if (!isActiveRef.current) return
      const parsed = parseRemoveResponse(payload)
      if (parsed === null || parsed.status === 'error') {
        setAnnouncement(`The ${kind} could not be removed.`)
        return
      }
      hasChangedRef.current = true
      const drop = (current: LibraryTag[]) =>
        current.filter((existing) => existing.id !== tag.id)
      if (kind === 'genre') setGenres(drop)
      else setMoods(drop)
      setAnnouncement(`Removed ${kind} ${tag.name}.`)
    })
  }

  const hideTag = (kind: TagKind, tag: LibraryTag) => {
    enqueue(async () => {
      const payload = await requestJson('POST', {
        operation: 'hide',
        songId,
        kind,
        tagId: tag.id,
      })
      if (!isActiveRef.current) return
      const parsed = parseRemoveResponse(payload)
      if (parsed === null || parsed.status === 'error') {
        setAnnouncement(`The AI ${kind} could not be hidden.`)
        return
      }
      hasChangedRef.current = true
      const append = (current: LibraryTag[]) =>
        current.some((existing) => existing.id === tag.id)
          ? current
          : [...current, tag]
      if (kind === 'genre') setHiddenAiGenres(append)
      else setHiddenAiMoods(append)
      setAnnouncement(`Hidden AI ${kind} ${tag.name} for ${songTitle}.`)
    })
  }

  const showTag = (kind: TagKind, tag: LibraryTag) => {
    enqueue(async () => {
      const payload = await requestJson('DELETE', {
        operation: 'show',
        songId,
        kind,
        tagId: tag.id,
      })
      if (!isActiveRef.current) return
      const parsed = parseRemoveResponse(payload)
      if (parsed === null || parsed.status === 'error') {
        setAnnouncement(`The hidden AI ${kind} could not be restored.`)
        return
      }
      hasChangedRef.current = true
      const drop = (current: LibraryTag[]) =>
        current.filter((existing) => existing.id !== tag.id)
      if (kind === 'genre') setHiddenAiGenres(drop)
      else setHiddenAiMoods(drop)
      setAnnouncement(`Restored AI ${kind} ${tag.name} for ${songTitle}.`)
    })
  }

  const applyKindChange = (kind: TagKind, next: string[]) => {
    const selected = kind === 'genre' ? genres : moods
    const currentNames = selected.map((tag) => tag.name)
    for (const name of next) {
      if (!currentNames.includes(name)) addTag(kind, name)
    }
    for (const tag of selected) {
      if (!next.includes(tag.name)) removeTag(kind, tag)
    }
  }

  const handleGenresChange = (next: string[]) => {
    applyKindChange('genre', next)
  }

  const handleMoodsChange = (next: string[]) => {
    applyKindChange('mood', next)
  }

  const hiddenGenreIds = new Set(hiddenAiGenres.map((tag) => tag.id))
  const hiddenMoodIds = new Set(hiddenAiMoods.map((tag) => tag.id))
  const visibleAiGenres = aiGenres.filter((tag) => !hiddenGenreIds.has(tag.id))
  const visibleAiMoods = aiMoods.filter((tag) => !hiddenMoodIds.has(tag.id))
  const hasVisibleAiTags =
    visibleAiGenres.length > 0 || visibleAiMoods.length > 0
  const hasHiddenAiTags = hiddenAiGenres.length > 0 || hiddenAiMoods.length > 0

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={`Edit tags for ${songTitle}`}
        className={cn(
          buttonVariants({ size: 'icon-xs', variant: 'ghost' }),
          'text-muted-foreground',
        )}
      >
        <TagsIcon aria-hidden='true' className='size-3.5' />
      </PopoverTrigger>
      <PopoverContent>
        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1'>
            <PopoverTitle>Tags</PopoverTitle>
            {aiAttributes !== null ? (
              <div className='flex flex-col gap-0.5 text-xs text-muted-foreground'>
                <p>{formatAttributesLine(aiAttributes, aiConfidence)}</p>
                {aiAttributes.descriptors.length > 0 && (
                  <p>{aiAttributes.descriptors.join(', ')}</p>
                )}
                {aiAttributes.instrumentation.length > 0 && (
                  <p>{aiAttributes.instrumentation.join(', ')}</p>
                )}
              </div>
            ) : (
              <p className='text-xs text-muted-foreground'>No AI data yet.</p>
            )}
            {/* Named only when it differs from the recipe the panel already
                names, so the common case stays one short word. */}
            {recipeLabel !== null && (
              <p className='text-xs text-muted-foreground'>
                Recipe: {isCurrentRecipe ? 'current' : recipeLabel}
              </p>
            )}
          </div>
          {(hasVisibleAiTags || hasHiddenAiTags) && (
            <div className='flex flex-col gap-2'>
              <p className='text-xs font-medium text-muted-foreground'>
                AI tags
              </p>
              {hasVisibleAiTags && (
                <div className='flex flex-wrap gap-1.5'>
                  {visibleAiGenres.map((tag) => (
                    <Button
                      key={`ai-genre-${tag.id}`}
                      aria-label={`Hide AI genre ${tag.name} for ${songTitle}`}
                      size='xs'
                      variant='secondary'
                      onClick={() => {
                        hideTag('genre', tag)
                      }}
                    >
                      {tag.name}
                      <span aria-hidden='true'>×</span>
                    </Button>
                  ))}
                  {visibleAiMoods.map((tag) => (
                    <Button
                      key={`ai-mood-${tag.id}`}
                      aria-label={`Hide AI mood ${tag.name} for ${songTitle}`}
                      size='xs'
                      variant='secondary'
                      onClick={() => {
                        hideTag('mood', tag)
                      }}
                    >
                      {tag.name}
                      <span aria-hidden='true'>×</span>
                    </Button>
                  ))}
                </div>
              )}
              {hasHiddenAiTags && (
                <div className='flex flex-col items-start gap-2'>
                  <Button
                    aria-expanded={isShowingHidden}
                    size='xs'
                    variant='ghost'
                    onClick={() => {
                      setIsShowingHidden((current) => !current)
                    }}
                  >
                    {isShowingHidden ? 'Hide hidden tags' : 'Show hidden tags'}
                  </Button>
                  {isShowingHidden && (
                    <div className='flex flex-wrap gap-1.5'>
                      {hiddenAiGenres.map((tag) => (
                        <Button
                          key={`hidden-genre-${tag.id}`}
                          aria-label={`Show AI genre ${tag.name} again for ${songTitle}`}
                          size='xs'
                          variant='outline'
                          onClick={() => {
                            showTag('genre', tag)
                          }}
                        >
                          Undo {tag.name}
                        </Button>
                      ))}
                      {hiddenAiMoods.map((tag) => (
                        <Button
                          key={`hidden-mood-${tag.id}`}
                          aria-label={`Show AI mood ${tag.name} again for ${songTitle}`}
                          size='xs'
                          variant='outline'
                          onClick={() => {
                            showTag('mood', tag)
                          }}
                        >
                          Undo {tag.name}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <TagKindEditor
            kind='genre'
            label='Your genres'
            placeholder='Add genre'
            selected={genres}
            songTitle={songTitle}
            onValueChange={handleGenresChange}
          />
          <TagKindEditor
            kind='mood'
            label='Your moods'
            placeholder='Add mood'
            selected={moods}
            songTitle={songTitle}
            onValueChange={handleMoodsChange}
          />
        </div>
        <div aria-live='polite' className='sr-only' role='status'>
          {announcement}
        </div>
      </PopoverContent>
    </Popover>
  )
}
