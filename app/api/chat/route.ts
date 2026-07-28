import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from 'ai'

import { resolveChatModel } from '@/lib/ai/chat-model'
import { errorResponse, requireUser } from '@/lib/api/route-helpers'
import {
  getLibraryTagSummary,
  type LibraryTagSummary,
} from '@/lib/chat/library-search'
import { buildChatSystemPrompt } from '@/lib/chat/prompt'
import { createChatTools } from '@/lib/chat/tools'
import { isRecord, readJson } from '@/lib/json'
import { createClient } from '@/lib/supabase/server'

/** Chat runs the stronger model with a multi-step tool loop — allow headroom. */
export const maxDuration = 300

/** Cap conversation length to bound token cost per request. */
const MAX_MESSAGES = 40

/** Tool-call loop budget (search → refine → propose within one turn). */
const MAX_STEPS = 8

/**
 * Streaming chat endpoint. Gates on getUser() itself (not behind proxy.ts).
 * The RLS client scopes every library read the tools perform to the signed-in
 * user; the model only ever sees the user's own songs.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { user, response } = await requireUser(supabase)
  if (user === null) return response

  const body = await readJson(request)
  if (
    !isRecord(body) ||
    !Array.isArray(body.messages) ||
    body.messages.length > MAX_MESSAGES
  ) {
    return errorResponse('Invalid request body', 400)
  }

  let uiMessages
  try {
    uiMessages = await validateUIMessages({ messages: body.messages })
  } catch {
    return errorResponse('Invalid messages', 400)
  }

  const modelResult = resolveChatModel()
  if (modelResult.status === 'error') {
    return errorResponse(modelResult.message, 503)
  }

  // The same summary grounds the prompt and bounds what search_library may
  // resolve, so the assistant can search exactly the tags it was shown.
  let summary: LibraryTagSummary
  try {
    summary = await getLibraryTagSummary(supabase)
  } catch (error) {
    console.error('[chat] library summary failed:', error)
    return errorResponse('Could not read your library', 500)
  }

  const modelMessages = await convertToModelMessages(uiMessages)
  const result = streamText({
    model: modelResult.model,
    instructions: buildChatSystemPrompt(summary),
    messages: modelMessages,
    tools: createChatTools(supabase, summary),
    stopWhen: stepCountIs(MAX_STEPS),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => {
        console.error('[chat]', error)
        return 'Something went wrong generating a response.'
      },
    }),
  })
}
