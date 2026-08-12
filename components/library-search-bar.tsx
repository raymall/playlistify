'use client'

import Form from 'next/form'
import { useRouter } from 'next/navigation'
import {
  type ComponentProps,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
} from '@/components/ui/combobox'
import {
  CONFIDENCE_BAND_ORDER,
  CONFIDENCE_BANDS,
  type ConfidenceBand,
  readConfidenceBand,
} from '@/lib/enrichment/confidence'
import {
  buildLibraryHref,
  clearLibraryFilters,
  countLibraryFilters,
  type LibrarySearchState,
  type LibraryTagFilter,
  listLibraryFilters,
  MIN_TAG_QUERY_LENGTH,
  withLibraryBand,
  withLibraryFilter,
  withLibraryQuery,
  withoutLibraryBand,
  withoutLibraryFilter,
} from '@/lib/library/search-params'
import { useTagSuggestions } from '@/lib/library/use-tag-suggestions'
import { normalizeTagName } from '@/lib/vocabulary'

type LibrarySearchBarProps = {
  state: LibrarySearchState
}

type LibrarySearchItem =
  | { kind: 'text'; name: string }
  | { kind: 'genre'; name: string; songCount: number; isCapped: boolean }
  | { kind: 'mood'; name: string; songCount: number; isCapped: boolean }
  | { kind: 'band'; band: ConfidenceBand }

type LibrarySearchGroup = {
  key: string
  label: string
  items: LibrarySearchItem[]
}

/** A pill in the chips field: a tag, or a Confidence band. */
type AppliedFilter =
  | { kind: 'tag'; filter: LibraryTagFilter }
  | { kind: 'band'; band: ConfidenceBand }

/**
 * The free-text row's value. Every filter value carries a `kind:value` colon,
 * so a bare sentinel can never collide with one.
 */
const TEXT_ITEM_VALUE = 'text'

const toItemValue = (item: LibrarySearchItem) => {
  if (item.kind === 'text') return TEXT_ITEM_VALUE
  if (item.kind === 'band') return `band:${item.band}`
  return `${item.kind}:${item.name}`
}

const toFilterValue = (applied: AppliedFilter) =>
  applied.kind === 'band'
    ? `band:${applied.band}`
    : `${applied.filter.kind}:${applied.filter.name}`

const parseFilterValue = (value: string): AppliedFilter | null => {
  const separator = value.indexOf(':')
  if (separator < 0) return null
  const kind = value.slice(0, separator)
  const rest = value.slice(separator + 1)
  if (kind === 'band') {
    const band = readConfidenceBand(rest)
    return band === null ? null : { kind: 'band', band }
  }
  if (kind !== 'genre' && kind !== 'mood') return null
  return rest.length === 0
    ? null
    : { kind: 'tag', filter: { kind, name: rest } }
}

const KIND_LABELS = { genre: 'Genre', mood: 'Mood' } as const

/**
 * One input for both jobs. The user has a word in their head ("shoegaze") and
 * does not yet know whether it is a tag in their library or text in a title;
 * making them pick a box first asks them to answer the question the search
 * exists to answer.
 *
 * The usual omnibox problem — "what does Enter do?" — is solved by making the
 * free-text commit an explicit row in the listbox rather than a guess. Nothing
 * is auto-highlighted, so Enter on an untouched popup falls through to the
 * form's plain GET, which is also the no-JS path.
 *
 * Free text lives in the input, not as a chip: a query gets edited in place.
 * Tags are chips because they are discrete and unordered. The asymmetry is the
 * point.
 */
export const LibrarySearchBar = ({ state }: LibrarySearchBarProps) => {
  const router = useRouter()
  const inputId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const highlightedRef = useRef<string | undefined>(undefined)
  const [isPending, startTransition] = useTransition()

  // Props are stale for as long as a navigation is pending, so two pills
  // clicked inside 300 ms would drop the first. The echo is the working copy;
  // it resyncs from props during render whenever new server truth lands.
  const [echo, setEcho] = useState(state)
  const [prevState, setPrevState] = useState(state)
  const [inputValue, setInputValue] = useState(state.query)
  if (prevState !== state) {
    // Only adopt an incoming query when the user has not typed past the one
    // that produced it — a pill navigation must not wipe in-progress typing.
    if (prevState.query !== state.query && inputValue === prevState.query) {
      setInputValue(state.query)
    }
    setPrevState(state)
    setEcho(state)
  }

  const suggestions = useTagSuggestions(inputValue)
  const trimmedInput = inputValue.trim()
  const lowerInput = trimmedInput.toLowerCase()
  const normalizedInput = normalizeTagName(inputValue)
  const pills: AppliedFilter[] = [
    ...listLibraryFilters(echo).map((filter): AppliedFilter => ({
      kind: 'tag',
      filter,
    })),
    ...echo.bands.map((band): AppliedFilter => ({ kind: 'band', band })),
  ]
  const appliedValues = pills.map(toFilterValue)

  const suggested =
    suggestions.status === 'ready' ? suggestions.suggestions : []
  const groups: LibrarySearchGroup[] = []
  if (trimmedInput.length > 0) {
    groups.push({
      key: 'text',
      label: 'Search text',
      items: [{ kind: 'text', name: trimmedInput }],
    })
  }
  for (const kind of ['genre', 'mood'] as const) {
    const items = suggested
      .filter((suggestion) => suggestion.kind === kind)
      .map((suggestion) => ({
        kind,
        name: suggestion.name,
        songCount: suggestion.songCount,
        isCapped: suggestion.isCapped,
      }))
    if (items.length > 0) {
      groups.push({
        key: kind,
        label: kind === 'genre' ? 'Genres' : 'Moods',
        items,
      })
    }
  }
  // Bands are a closed set of five, so they match locally — no request, and no
  // three-character gate, which is why "hi" can already offer High while tag
  // suggestions are still below their minimum.
  if (trimmedInput.length > 0) {
    const bandItems = CONFIDENCE_BAND_ORDER.filter((band) =>
      CONFIDENCE_BANDS[band].label.toLowerCase().includes(lowerInput),
    ).map((band): LibrarySearchItem => ({ kind: 'band', band }))
    if (bandItems.length > 0) {
      groups.push({ key: 'band', label: 'Confidence', items: bandItems })
    }
  }

  const commit = (next: LibrarySearchState) => {
    setEcho(next)
    startTransition(() => {
      // scroll: false — the results sit directly below, and yanking the page to
      // the top on every refinement is disorienting.
      router.push(buildLibraryHref(next), { scroll: false })
    })
  }

  const commitQuery = () => {
    commit(withLibraryQuery(echo, inputValue))
  }

  const handleValueChange = (next: string[]) => {
    if (next.includes(TEXT_ITEM_VALUE)) {
      commitQuery()
      return
    }

    const applied = new Set(appliedValues)
    const incoming = new Set(next)
    let nextState = echo
    for (const value of next) {
      const added = applied.has(value) ? null : parseFilterValue(value)
      if (added === null) continue
      nextState =
        added.kind === 'band'
          ? withLibraryBand(nextState, added.band)
          : withLibraryFilter(nextState, added.filter)
    }
    let hasRemoved = false
    for (const value of appliedValues) {
      const removed = incoming.has(value) ? null : parseFilterValue(value)
      if (removed === null) continue
      nextState =
        removed.kind === 'band'
          ? withoutLibraryBand(nextState, removed.band)
          : withoutLibraryFilter(nextState, removed.filter)
      hasRemoved = true
    }
    if (nextState === echo) return

    // Removing a chip unmounts the button that had focus, which would drop it
    // to <body>. Base UI keeps focus in the input when adding.
    if (hasRemoved) inputRef.current?.focus()
    commit(nextState)
  }

  const handleClear = () => {
    setInputValue('')
    inputRef.current?.focus()
    commit(clearLibraryFilters())
  }

  const handleInputValueChange = (value: string) => {
    // Typing invalidates any highlight, so Enter is a text commit again until
    // the user arrows back into the list.
    highlightedRef.current = undefined
    setInputValue(value)
  }

  // Base UI consumes Enter on ComboboxInput: it clears the query and stops the
  // event, so the form's implicit submit never fires. Committing from keydown
  // is the documented fallback. preventDefault() here also keeps Base UI's own
  // merged handler from wiping the text the user just searched for — Base UI
  // skips its internal handlers once the event is defaulted.
  const handleInputKeyDown: NonNullable<
    ComponentProps<'input'>['onKeyDown']
  > = (event) => {
    if (event.key !== 'Enter') return
    // A highlighted row is Base UI's to select; only a bare Enter is ours.
    if (highlightedRef.current !== undefined) return
    event.preventDefault()
    commitQuery()
  }

  // Still needed for the Search button, which is a real submit. Typed off the
  // element rather than React's own FormEventHandler alias, which the installed
  // typings mark deprecated.
  const handleSubmit: NonNullable<ComponentProps<'form'>['onSubmit']> = (
    event,
  ) => {
    event.preventDefault()
    if (highlightedRef.current !== undefined) return
    commitQuery()
  }

  const statusMessage = (() => {
    if (trimmedInput.length === 0) return ''
    if (normalizedInput.length < MIN_TAG_QUERY_LENGTH) {
      return `Type ${MIN_TAG_QUERY_LENGTH} letters to see tag suggestions.`
    }
    if (suggestions.status === 'loading') return 'Loading tag suggestions…'
    if (suggestions.status === 'unavailable') {
      return 'Tag suggestions are unavailable right now.'
    }
    if (suggestions.status === 'ready' && suggested.length === 0) {
      return `No tags match “${normalizedInput}”.`
    }
    return ''
  })()

  return (
    <Form
      action='/library'
      aria-busy={isPending}
      className='flex flex-col gap-1.5'
      role='search'
      onSubmit={handleSubmit}
    >
      {/* Carried through the no-JS round trip; the client push rebuilds the
          same href from state. */}
      {echo.genres.map((name) => (
        <input key={`genre-${name}`} name='genre' type='hidden' value={name} />
      ))}
      {echo.moods.map((name) => (
        <input key={`mood-${name}`} name='mood' type='hidden' value={name} />
      ))}
      {echo.bands.map((band) => (
        <input key={`band-${band}`} name='band' type='hidden' value={band} />
      ))}

      <label className='text-sm font-medium' htmlFor={inputId}>
        Search your library
      </label>

      <Combobox<string, true>
        multiple
        autoHighlight={false}
        filter={null}
        inputValue={inputValue}
        items={groups}
        value={appliedValues}
        onInputValueChange={handleInputValueChange}
        onItemHighlighted={(value) => {
          highlightedRef.current = value
        }}
        onValueChange={handleValueChange}
      >
        <div className='flex max-w-2xl items-start gap-2'>
          <ComboboxChips>
            {pills.map((pill) => {
              const label =
                pill.kind === 'band'
                  ? CONFIDENCE_BANDS[pill.band].label
                  : pill.filter.name
              const prefix =
                pill.kind === 'band'
                  ? 'Confidence'
                  : KIND_LABELS[pill.filter.kind]
              const target =
                pill.kind === 'band'
                  ? `confidence ${label}`
                  : `${pill.filter.kind} ${label}`
              return (
                <ComboboxChip key={toFilterValue(pill)}>
                  <span className='sr-only'>{prefix} filter: </span>
                  {label}
                  <ComboboxChipRemove aria-label={`Remove ${target} filter`} />
                </ComboboxChip>
              )
            })}
            <ComboboxInput
              ref={inputRef}
              aria-describedby={hintId}
              id={inputId}
              name='q'
              placeholder={pills.length === 0 ? 'Search title or artist' : ''}
              onKeyDown={handleInputKeyDown}
            />
          </ComboboxChips>
          <button
            className={buttonVariants({ size: 'lg', variant: 'outline' })}
            type='submit'
          >
            Search
          </button>
          {countLibraryFilters(echo) > 0 && (
            <Button
              className='shrink-0'
              size='lg'
              type='button'
              variant='ghost'
              onClick={handleClear}
            >
              Clear all filters
            </Button>
          )}
        </div>

        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxStatus>{statusMessage}</ComboboxStatus>
              <ComboboxList className='max-h-72 border-0'>
                {(group: LibrarySearchGroup) => (
                  <ComboboxGroup key={group.key} items={group.items}>
                    <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                    <ComboboxCollection>
                      {(item: LibrarySearchItem) => (
                        <ComboboxItem
                          key={toItemValue(item)}
                          value={toItemValue(item)}
                        >
                          {item.kind === 'text' && (
                            <span className='truncate'>
                              Search “{item.name}” in titles and artists
                            </span>
                          )}
                          {item.kind === 'band' && (
                            <>
                              <span className='truncate'>
                                {CONFIDENCE_BANDS[item.band].label}
                              </span>
                              <span className='ml-auto shrink-0 text-xs text-muted-foreground'>
                                confidence band
                              </span>
                            </>
                          )}
                          {(item.kind === 'genre' || item.kind === 'mood') && (
                            <>
                              <span className='truncate'>{item.name}</span>
                              <span className='ml-auto shrink-0 text-xs text-muted-foreground tabular-nums'>
                                {item.songCount.toLocaleString()}
                                {item.isCapped ? '+' : ''} songs
                              </span>
                            </>
                          )}
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
              <ComboboxEmpty>
                {trimmedInput.length === 0
                  ? 'Type a title, an artist, or a tag.'
                  : ''}
              </ComboboxEmpty>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>

      <p className='text-xs text-muted-foreground' id={hintId}>
        Type a title or artist, or pick a tag or Confidence band to filter. Tags
        combine with AND, bands with OR.
      </p>

      <p aria-live='polite' className='sr-only' role='status'>
        {isPending ? 'Searching…' : ''}
      </p>
    </Form>
  )
}
