'use client'

import {
  type ChatStatus,
  getToolName,
  isStaticToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from 'ai'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { readSearchSummary } from '@/lib/chat/contract'
import { usePromptSuggestions } from '@/lib/chat/use-prompt-suggestions'
import { isRecord } from '@/lib/json'

type ChatConversationProps = {
  messages: UIMessage[]
  status: ChatStatus
  error: Error | undefined
  onSend: (text: string) => void
  onStop: () => void
  onRetry: () => void
}

const describeSearchInput = (input: unknown): string => {
  if (!isRecord(input)) return ''
  const terms: string[] = []
  for (const key of ['genres', 'moods', 'eras'] as const) {
    const value = input[key]
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim().length > 0) {
          terms.push(entry.trim())
        }
      }
    }
  }
  return terms.slice(0, 4).join(', ')
}

/** Human-readable activity line for one tool part (visible + announced). */
const toolActivityText = (part: ToolUIPart): string => {
  const name = getToolName(part)
  if (name === 'search_library') {
    if (part.state === 'output-error') {
      return 'Library search failed.'
    }
    if (part.state === 'output-available') {
      const summary = readSearchSummary(part.output)
      if (summary === null) return 'Searched your library.'
      const { matchCount, unmatchedTagCount } = summary
      const base = `Found ${matchCount} matching ${
        matchCount === 1 ? 'song' : 'songs'
      }.`
      return unmatchedTagCount > 0
        ? `${base} Some tags weren’t in your library.`
        : base
    }
    const terms = describeSearchInput(part.input)
    return terms.length > 0
      ? `Searching your library — ${terms}…`
      : 'Searching your library…'
  }
  if (name === 'propose_playlist') {
    if (part.state === 'output-error') return 'Could not build the playlist.'
    if (part.state === 'output-available') {
      return 'Playlist ready — see the preview panel.'
    }
    return 'Drafting the playlist…'
  }
  return ''
}

const ToolActivity = ({ part }: { part: ToolUIPart }) => {
  const text = toolActivityText(part)
  if (text.length === 0) return null
  const isError = part.state === 'output-error'
  return (
    <p
      className={
        isError
          ? 'text-sm text-destructive'
          : 'text-sm text-muted-foreground italic'
      }
    >
      {text}
    </p>
  )
}

const EXACT_DUPLICATE_TEXT = /^([\s\S]{20,}?)\s+\1$/

const collapseExactDuplicateText = (value: string): string => {
  const text = value.trim()
  return EXACT_DUPLICATE_TEXT.exec(text)?.[1] ?? text
}

const MessageParts = ({ message }: { message: UIMessage }) => {
  const renderedAssistantText = new Set<string>()

  return (
    <>
      {message.parts.map((part, index) => {
        if (part.type === 'text') {
          const text = collapseExactDuplicateText(part.text)
          if (text.length === 0) return null
          const normalizedText = text.replace(/\s+/g, ' ')
          if (
            message.role === 'assistant' &&
            renderedAssistantText.has(normalizedText)
          ) {
            return null
          }
          renderedAssistantText.add(normalizedText)
          return (
            <p
              key={index}
              className='text-sm whitespace-pre-wrap text-foreground'
            >
              {text}
            </p>
          )
        }
        if (isStaticToolUIPart(part)) {
          return <ToolActivity key={index} part={part} />
        }
        return null
      })}
    </>
  )
}

/** Latest tool-activity string, for the live region. */
const deriveLiveAnnouncement = (
  messages: UIMessage[],
  status: ChatStatus,
): string => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    for (let j = message.parts.length - 1; j >= 0; j -= 1) {
      const part = message.parts[j]
      if (isStaticToolUIPart(part)) {
        const text = toolActivityText(part)
        if (text.length > 0) return text
      }
    }
    break
  }
  return status === 'submitted' ? 'Working on your request…' : ''
}

type PromptSuggestionsProps = {
  status: ChatStatus
  onSend: (text: string) => void
}

const PROMPT_SKELETON_CLASSES = [
  'h-8 w-64 max-w-full',
  'h-8 w-72 max-w-full',
  'h-8 w-80 max-w-full',
] as const

const PromptSuggestions = ({ status, onSend }: PromptSuggestionsProps) => {
  const suggestionState = usePromptSuggestions()

  if (suggestionState.status === 'unavailable') return null

  return (
    <div className='flex flex-col gap-5'>
      <p className='text-sm text-muted-foreground'>
        Describe the playlist you want and I’ll build it from your library. For
        example:
      </p>
      <div className='flex flex-col items-stretch gap-2'>
        {suggestionState.status === 'loading' ? (
          <>
            <span className='sr-only' role='status'>
              Loading playlist suggestions…
            </span>
            {PROMPT_SKELETON_CLASSES.map((className) => (
              <Skeleton
                key={className}
                aria-hidden='true'
                className={className}
              />
            ))}
          </>
        ) : (
          suggestionState.suggestions.map((prompt) => (
            <Button
              key={prompt}
              className='h-auto justify-start py-3 text-left whitespace-normal normal-case'
              disabled={status !== 'ready'}
              size='sm'
              variant='outline'
              onClick={() => {
                onSend(prompt)
              }}
            >
              {prompt}
            </Button>
          ))
        )}
      </div>
    </div>
  )
}

export const ChatConversation = ({
  messages,
  status,
  error,
  onSend,
  onStop,
  onRetry,
}: ChatConversationProps) => {
  const [input, setInput] = useState('')
  const isStreaming = status === 'streaming' || status === 'submitted'
  const canSend = status === 'ready' && input.trim().length > 0

  const submit = () => {
    if (!canSend) return
    onSend(input.trim())
    setInput('')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-5'>
        {messages.length === 0 ? (
          <PromptSuggestions status={status} onSend={onSend} />
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === 'user'
                  ? 'flex flex-col gap-1 border-l-4 border-border bg-muted px-3 py-3'
                  : 'flex flex-col gap-1 border-l border-border pl-3'
              }
            >
              <span className='sr-only'>
                {message.role === 'user' ? 'You said:' : 'Assistant:'}
              </span>
              <MessageParts message={message} />
            </div>
          ))
        )}
      </div>

      {error !== undefined && (
        <div className='mx-4 flex items-center justify-between gap-3 border border-destructive/50 px-3 py-2'>
          <p className='text-sm text-destructive'>
            Something went wrong. Please try again.
          </p>
          <Button
            disabled={status !== 'ready'}
            size='sm'
            variant='outline'
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      )}

      <div className='flex flex-col gap-2 border-t-2 border-border p-4'>
        <label className='sr-only' htmlFor='chat-input'>
          Describe your playlist
        </label>
        <Textarea
          className='rounded-none border-control bg-background px-3 py-3 dark:bg-background'
          id='chat-input'
          placeholder='Describe a mood, setting, or sequence…'
          rows={4}
          value={input}
          onChange={(event) => {
            setInput(event.target.value)
          }}
          onKeyDown={handleKeyDown}
        />
        <div className='grid gap-2'>
          {isStreaming && (
            <Button size='sm' variant='outline' onClick={onStop}>
              Stop
            </Button>
          )}
          <Button
            className='w-full'
            disabled={!canSend}
            size='lg'
            onClick={submit}
          >
            Send
          </Button>
        </div>
      </div>

      <div aria-live='polite' className='sr-only' role='status'>
        {deriveLiveAnnouncement(messages, status)}
      </div>
    </div>
  )
}
