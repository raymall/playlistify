'use client'

import { TagsIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { buttonVariants } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { type SongAIAttributes } from '@/lib/enrichment/schema'
import { isRecord, readString } from '@/lib/json'
import { createClient } from '@/lib/supabase/client'
import {
  type TagAddResponse,
  type TagKind,
  type TagRemoveResponse,
} from '@/lib/tags'
import { cn } from '@/lib/utils'
import { isValidTagName, normalizeTagName } from '@/lib/vocabulary'

/** One personal tag: the shared-vocabulary row id plus its normalized name. */
export interface LibraryTag {
  id: string
  name: string
}

interface LibraryTagEditorProps {
  aiConfidence: number | null
  aiAttributes: SongAIAttributes | null
  songId: string
  songTitle: string
  userGenres: LibraryTag[]
  userMoods: LibraryTag[]
}

interface TagVocabulary {
  genres: string[]
  moods: string[]
}

/**
 * The shared vocabulary is fetched once per session, on first editor open,
 * through the browser client (genres/moods are SELECT-able under RLS). A
 * failed fetch clears the cache so the next open retries.
 */
let vocabularyPromise: Promise<TagVocabulary> | null = null

const loadVocabulary = (): Promise<TagVocabulary> => {
  vocabularyPromise ??= (async () => {
    const supabase = createClient()
    const [genresResult, moodsResult] = await Promise.all([
      supabase.from('genres').select('name').order('name'),
      supabase.from('moods').select('name').order('name'),
    ])
    if (genresResult.error !== null || moodsResult.error !== null) {
      vocabularyPromise = null
      throw new Error('Vocabulary fetch failed')
    }
    return {
      genres: genresResult.data.map((row) => row.name),
      moods: moodsResult.data.map((row) => row.name),
    }
  })()
  return vocabularyPromise
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

interface TagKindEditorProps {
  kind: TagKind
  label: string
  placeholder: string
  selected: LibraryTag[]
  vocabulary: string[] | null
  onValueChange: (next: string[]) => void
}

/**
 * One combobox over one vocabulary table. Renders `inline` with `open` set
 * unconditionally and no onOpenChange, per the Base UI inline contract —
 * forwarding the combobox's internal close requests would dismiss the whole
 * popover mid-interaction. There is no nested floating popup, and the
 * popover unmounting on close resets all transient state. Free entry works
 * by injecting the normalized query as the first item when it isn't in the
 * vocabulary yet.
 */
const TagKindEditor = ({
  kind,
  label,
  placeholder,
  selected,
  vocabulary,
  onValueChange,
}: TagKindEditorProps) => {
  const labelId = useId()
  const [inputValue, setInputValue] = useState('')

  const selectedNames = selected.map((tag) => tag.name)
  const vocab = vocabulary ?? []
  const query = normalizeTagName(inputValue)
  const matches =
    query.length === 0 ? vocab : vocab.filter((name) => name.includes(query))
  const isCreatable = isValidTagName(query) && !vocab.includes(query)
  const items = isCreatable ? [query, ...matches] : matches

  return (
    <Combobox
      inline
      multiple
      open
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
              <ComboboxChipRemove aria-label={`Remove ${kind} ${tag.name}`} />
            </ComboboxChip>
          ))}
          <ComboboxInput aria-labelledby={labelId} placeholder={placeholder} />
        </ComboboxChips>
        {vocabulary === null ? (
          <p className='px-1.5 text-xs text-muted-foreground'>
            Loading suggestions…
          </p>
        ) : (
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {isCreatable && item === query ? `Create "${item}"` : item}
              </ComboboxItem>
            )}
          </ComboboxList>
        )}
        <ComboboxEmpty>Type to add your own {kind}.</ComboboxEmpty>
      </div>
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
  songId,
  songTitle,
  userGenres,
  userMoods,
}: LibraryTagEditorProps) => {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [vocabulary, setVocabulary] = useState<TagVocabulary | null>(null)
  const [genres, setGenres] = useState(userGenres)
  const [moods, setMoods] = useState(userMoods)
  const [prevUserGenres, setPrevUserGenres] = useState(userGenres)
  const [prevUserMoods, setPrevUserMoods] = useState(userMoods)
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

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen)
    if (nextOpen) {
      loadVocabulary()
        .then((loaded) => {
          if (isActiveRef.current) setVocabulary(loaded)
        })
        .catch(() => {
          if (!isActiveRef.current) return
          setVocabulary({ genres: [], moods: [] })
          setAnnouncement(
            'Tag suggestions could not be loaded. Free entry still works.',
          )
        })
      return
    }
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
      const payload = await requestJson('POST', { songId, kind, name })
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
      setVocabulary((current) => {
        if (current === null) return current
        const list = kind === 'genre' ? current.genres : current.moods
        if (list.includes(tag.name)) return current
        const grown = [...list, tag.name].sort()
        return kind === 'genre'
          ? { ...current, genres: grown }
          : { ...current, moods: grown }
      })
      setAnnouncement(`Added ${kind} ${tag.name}.`)
    })
  }

  const removeTag = (kind: TagKind, tag: LibraryTag) => {
    enqueue(async () => {
      const payload = await requestJson('DELETE', {
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
          </div>
          <TagKindEditor
            kind='genre'
            label='Your genres'
            placeholder='Add genre'
            selected={genres}
            vocabulary={vocabulary?.genres ?? null}
            onValueChange={handleGenresChange}
          />
          <TagKindEditor
            kind='mood'
            label='Your moods'
            placeholder='Add mood'
            selected={moods}
            vocabulary={vocabulary?.moods ?? null}
            onValueChange={handleMoodsChange}
          />
        </div>
        <div className='sr-only' role='status'>
          {announcement}
        </div>
      </PopoverContent>
    </Popover>
  )
}
