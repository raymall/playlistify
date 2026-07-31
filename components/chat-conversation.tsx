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
import { Textarea } from '@/components/ui/textarea'
import { readSearchSummary } from '@/lib/chat/contract'
import { usePromptSuggestions } from '@/lib/chat/use-prompt-suggestions'
import { isRecord } from '@/lib/json'

interface ChatConversationProps {
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

const MessageParts = ({ message }: { message: UIMessage }) => (
  <>
    {message.parts.map((part, index) => {
      if (part.type === 'text') {
        if (part.text.trim().length === 0) return null
        return (
          <p
            key={index}
            className='text-sm whitespace-pre-wrap text-foreground'
          >
            {part.text}
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

const PromptSuggestions = ({ status, onSend }: PromptSuggestionsProps) => {
  const suggestions = usePromptSuggestions()

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-sm text-muted-foreground'>
        Describe the playlist you want and I’ll build it from your library. For
        example:
      </p>
      <div className='flex flex-col items-start gap-2'>
        {suggestions.map((prompt) => (
          <Button
            key={prompt}
            disabled={status !== 'ready'}
            size='sm'
            variant='outline'
            onClick={() => {
              onSend(prompt)
            }}
          >
            {prompt}
          </Button>
        ))}
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
    <div className='flex h-full flex-col gap-4'>
      <div className='flex flex-1 flex-col gap-4 overflow-y-auto'>
        {messages.length === 0 ? (
          <PromptSuggestions status={status} onSend={onSend} />
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === 'user'
                  ? 'flex flex-col gap-1 rounded-lg bg-muted px-3 py-2'
                  : 'flex flex-col gap-1'
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
        <div className='flex items-center justify-between gap-3 rounded-lg border border-destructive/50 px-3 py-2'>
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

      <div className='flex flex-col gap-2'>
        <label className='sr-only' htmlFor='chat-input'>
          Describe your playlist
        </label>
        <Textarea
          id='chat-input'
          placeholder='Describe the playlist you want…'
          rows={2}
          value={input}
          onChange={(event) => {
            setInput(event.target.value)
          }}
          onKeyDown={handleKeyDown}
        />
        <div className='flex items-center justify-end gap-2'>
          {isStreaming && (
            <Button size='sm' variant='outline' onClick={onStop}>
              Stop
            </Button>
          )}
          <Button disabled={!canSend} size='sm' onClick={submit}>
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
