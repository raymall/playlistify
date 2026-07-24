'use client'

import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  getToolName,
  isStaticToolUIPart,
  type UIMessage,
} from 'ai'

import { ChatConversation } from '@/components/chat-conversation'
import { PlaylistPreviewPanel } from '@/components/playlist-preview-panel'
import {
  type PlaylistProposal,
  readPlaylistProposal,
} from '@/lib/chat/contract'

/** The most recent well-formed proposal in the conversation, with its call id. */
const findLatestProposal = (
  messages: UIMessage[],
): { toolCallId: string; proposal: PlaylistProposal } | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    for (let j = message.parts.length - 1; j >= 0; j -= 1) {
      const part = message.parts[j]
      if (
        isStaticToolUIPart(part) &&
        getToolName(part) === 'propose_playlist' &&
        part.state === 'output-available'
      ) {
        const proposal = readPlaylistProposal(part.output)
        if (proposal !== null) {
          return { toolCallId: part.toolCallId, proposal }
        }
      }
    }
  }
  return null
}

/** The user's first message text — recorded as the playlist prompt. */
const findFirstPrompt = (messages: UIMessage[]): string | null => {
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim().length > 0) {
        return part.text.trim()
      }
    }
  }
  return null
}

/**
 * Owns the chat state. Streams to /api/chat via useChat, derives the latest
 * playlist proposal from the tool parts, and lays the conversation beside the
 * preview panel. The proposal only ever renders in the panel — never as chat
 * text. Remounting the panel on each new proposal (via `key`) resets its edit
 * state.
 */
export const ChatScreen = () => {
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  const latestProposal = findLatestProposal(messages)
  const prompt = findFirstPrompt(messages)
  const isBusy = status === 'streaming' || status === 'submitted'

  return (
    <div className='mt-8 grid gap-6 lg:h-[70vh] lg:grid-cols-2'>
      <div className='flex min-h-0 flex-col rounded-lg border p-4'>
        <ChatConversation
          error={error}
          messages={messages}
          status={status}
          onRetry={() => void regenerate()}
          onSend={(text) => void sendMessage({ text })}
          onStop={() => void stop()}
        />
      </div>

      <div className='min-h-0 lg:overflow-y-auto'>
        {latestProposal !== null ? (
          <PlaylistPreviewPanel
            key={latestProposal.toolCallId}
            isBusy={isBusy}
            prompt={prompt}
            proposal={latestProposal.proposal}
            onRegenerate={() =>
              void sendMessage({
                text: 'Regenerate the playlist with different tracks.',
              })
            }
          />
        ) : (
          <div className='flex h-full items-center justify-center rounded-lg border border-dashed p-6'>
            <p className='max-w-xs text-center text-sm text-muted-foreground'>
              Your playlist preview will appear here once I’ve put one together.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
