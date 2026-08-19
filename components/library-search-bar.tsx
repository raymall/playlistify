'use client'

import { SearchIcon } from 'lucide-react'
import Form from 'next/form'
import { useRouter } from 'next/navigation'
import {
  type ComponentProps,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react'

import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxCollection,
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
  type LibrarySearchState,
  type LibraryTagFilter,
  listLibraryFilters,
  withLibraryBand,
  withLibraryFilter,
  withLibraryQuery,
  withoutLibraryBand,
  withoutLibraryFilter,
} from '@/lib/library/search-params'
import { useTagSuggestions } from '@/lib/library/use-tag-suggestions'

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
  const inputRef = useRef<HTMLInputElement>(null)
  const highlightedRef = useRef<string | undefined>(undefined)
  const [isPending, startTransition] = useTransition()
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false)

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
  const pills: AppliedFilter[] = [
    ...listLibraryFilters(echo).map((filter): AppliedFilter => ({
      kind: 'tag',
      filter,
    })),
    ...echo.bands.map((band): AppliedFilter => ({ kind: 'band', band })),
  ]
  const genrePills = pills.filter(
    (pill) => pill.kind === 'tag' && pill.filter.kind === 'genre',
  )
  const moodPills = pills.filter(
    (pill) => pill.kind === 'tag' && pill.filter.kind === 'mood',
  )
  const bandPills = pills.filter((pill) => pill.kind === 'band')
  const appliedValues = pills.map(toFilterValue)

  const suggested =
    suggestions.status === 'ready' ? suggestions.suggestions : []
  const groups: LibrarySearchGroup[] = []
  if (trimmedInput.length > 0) {
    groups.push({
      key: 'text',
      label: 'Titles / artists',
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
    setIsSuggestionsOpen(false)
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
    if (hasRemoved) {
      inputRef.current?.focus()
    } else {
      setInputValue(echo.query)
    }
    setIsSuggestionsOpen(false)
    commit(nextState)
  }

  const handleClear = () => {
    setInputValue('')
    setIsSuggestionsOpen(false)
    inputRef.current?.focus()
    commit(clearLibraryFilters())
  }

  const handleInputValueChange = (
    value: string,
    eventDetails: { reason: string },
  ) => {
    // Closing the popup can emit an internal empty value before a submit
    // click. Only a real keystroke is allowed to replace the user's draft.
    if (eventDetails.reason !== 'input-change') return

    // Typing invalidates any highlight, so Enter is a text commit again until
    // the user arrows back into the list.
    highlightedRef.current = undefined
    setInputValue(value)
    setIsSuggestionsOpen(value.trim().length > 0)
  }

  const handleOpenChange = (
    nextOpen: boolean,
    eventDetails: { reason: string },
  ) => {
    if (!nextOpen) {
      highlightedRef.current = undefined
      setIsSuggestionsOpen(false)
      return
    }

    // An existing query should stay quiet when the input merely receives
    // focus. Typing is the only interaction that reveals suggestions.
    if (eventDetails.reason === 'input-change' && trimmedInput.length > 0) {
      setIsSuggestionsOpen(true)
    }
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

  // Still needed for the magnifying-glass action, which is a real submit.
  // Typed off the element rather than React's own FormEventHandler alias,
  // which the installed typings mark deprecated.
  const handleSubmit: NonNullable<ComponentProps<'form'>['onSubmit']> = (
    event,
  ) => {
    event.preventDefault()
    if (highlightedRef.current !== undefined) return
    commitQuery()
  }

  const statusMessage = (() => {
    if (trimmedInput.length === 0) return ''
    if (suggestions.status === 'loading') return 'Looking through your tags…'
    if (suggestions.status === 'unavailable') {
      return 'Tag matches are unavailable. Title and artist search still works.'
    }
    if (suggestions.status === 'ready' && suggested.length === 0) {
      return 'No matching tags. Title and artist search is still available.'
    }
    return ''
  })()

  return (
    <Form
      action='/library'
      aria-busy={isPending}
      className='flex w-full flex-col gap-2'
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

      <label className='sr-only' htmlFor={inputId}>
        Search your library
      </label>

      <Combobox<string, true>
        multiple
        autoHighlight={false}
        filter={null}
        inputValue={inputValue}
        items={groups}
        open={isSuggestionsOpen}
        openOnInputClick={false}
        value={appliedValues}
        onInputValueChange={handleInputValueChange}
        onItemHighlighted={(value) => {
          highlightedRef.current = value
        }}
        onOpenChange={handleOpenChange}
        onValueChange={handleValueChange}
      >
        <ComboboxChips className='flex flex-col items-stretch gap-2 border-0 p-0 focus-within:border-transparent focus-within:ring-0 dark:bg-transparent'>
          <div className='flex h-12 w-full items-stretch gap-2'>
            <div className='flex min-w-0 flex-1 border-b border-input bg-transparent transition-colors focus-within:border-control'>
              <ComboboxInput
                ref={inputRef}
                className='h-full min-w-0 px-4 py-2 text-base placeholder:text-muted-foreground'
                id={inputId}
                name='q'
                placeholder='Search titles, artists, genres or moods'
                onKeyDown={handleInputKeyDown}
              />
            </div>
            <Button aria-label='Search library' size='icon-lg' type='submit'>
              <SearchIcon
                aria-hidden='true'
                className='size-6'
                strokeWidth={1.5}
              />
            </Button>
          </div>

          {pills.length > 0 && (
            <div className='flex w-full flex-wrap items-center gap-x-5 gap-y-2 border border-border bg-popover px-3 py-2'>
              {[
                { key: 'genres', label: 'Genres', values: genrePills },
                { key: 'moods', label: 'Moods', values: moodPills },
                { key: 'bands', label: 'Confidence', values: bandPills },
              ].map(
                (group) =>
                  group.values.length > 0 && (
                    <div
                      key={group.key}
                      className='flex min-w-0 items-center gap-1'
                    >
                      <span className='editorial-kicker shrink-0 text-muted-foreground'>
                        {group.label}:
                      </span>
                      <div className='flex min-w-0 flex-wrap gap-1'>
                        {group.values.map((pill) => {
                          const label =
                            pill.kind === 'band'
                              ? CONFIDENCE_BANDS[pill.band].label
                              : pill.filter.name
                          const target =
                            pill.kind === 'band'
                              ? `confidence ${label}`
                              : `${pill.filter.kind} ${label}`
                          return (
                            <ComboboxChip
                              key={toFilterValue(pill)}
                              className='border-0 bg-control-soft text-control-soft-foreground'
                            >
                              {label}
                              <ComboboxChipRemove
                                aria-label={`Remove ${target} filter`}
                              />
                            </ComboboxChip>
                          )
                        })}
                      </div>
                    </div>
                  ),
              )}
              <Button
                className='ms-auto shrink-0'
                size='sm'
                type='button'
                variant='ghost'
                onClick={handleClear}
              >
                Clear all
              </Button>
            </div>
          )}
        </ComboboxChips>

        <ComboboxPortal>
          <ComboboxPositioner sideOffset={8}>
            <ComboboxPopup className='rounded-none border border-border bg-popover p-0 shadow-none ring-0'>
              <ComboboxStatus className='border-b border-border px-4 py-3 font-mono text-[0.6875rem]'>
                {statusMessage}
              </ComboboxStatus>
              <ComboboxList className='max-h-80 rounded-none border-0 p-0'>
                {(group: LibrarySearchGroup) => (
                  <ComboboxGroup
                    key={group.key}
                    className='border-t border-border first:border-t-0'
                    items={group.items}
                  >
                    <ComboboxGroupLabel className='border-b border-border bg-popover px-4 py-2 text-muted-foreground'>
                      {group.label}
                    </ComboboxGroupLabel>
                    <ComboboxCollection>
                      {(item: LibrarySearchItem) => (
                        <ComboboxItem
                          key={toItemValue(item)}
                          className='min-h-12 rounded-none border-b border-border/70 px-4 py-3 pl-9 last:border-b-0 data-highlighted:bg-control-soft data-highlighted:text-control-soft-foreground data-highlighted:[&_.suggestion-meta]:text-control-soft-foreground/70'
                          value={toItemValue(item)}
                        >
                          {item.kind === 'text' && (
                            <>
                              <span className='truncate font-medium'>
                                Search “{item.name}”
                              </span>
                              <span className='suggestion-meta ml-auto shrink-0 font-mono text-[0.6875rem] tracking-[0.08em] text-muted-foreground uppercase'>
                                Enter
                              </span>
                            </>
                          )}
                          {item.kind === 'band' && (
                            <>
                              <span className='truncate'>
                                {CONFIDENCE_BANDS[item.band].label}
                              </span>
                              <span className='suggestion-meta ml-auto shrink-0 font-mono text-[0.6875rem] tracking-[0.08em] text-muted-foreground uppercase'>
                                Confidence
                              </span>
                            </>
                          )}
                          {(item.kind === 'genre' || item.kind === 'mood') && (
                            <>
                              <span className='truncate'>{item.name}</span>
                              <span className='suggestion-meta ml-auto shrink-0 font-mono text-[0.6875rem] text-muted-foreground tabular-nums'>
                                {item.songCount.toLocaleString()}
                                {item.isCapped ? '+' : ''}{' '}
                                {item.songCount === 1 ? 'song' : 'songs'}
                              </span>
                            </>
                          )}
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>

      <p aria-live='polite' className='sr-only' role='status'>
        {isPending ? 'Searching…' : ''}
      </p>
    </Form>
  )
}
