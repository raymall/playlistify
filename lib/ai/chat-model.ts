// Server-only resolver for the conversational playlist model. Unlike
// enrichment (model chosen from the llm_models catalog per run), chat uses a
// single build-wide model set via the CHAT_MODEL env var — no schema row.

import {
  type ResolveModelResult,
  resolveProviderModel,
} from '@/lib/ai/providers'

/** Fallback when CHAT_MODEL is unset. `provider:model_id`, split on first ':'. */
export const DEFAULT_CHAT_MODEL = 'openai:gpt-5.4'

/**
 * Resolve the chat model from `CHAT_MODEL` (`provider:model_id`), falling back
 * to DEFAULT_CHAT_MODEL. Returns the same ok/error variant as
 * resolveProviderModel; the chat route maps `error` to a 503.
 */
export const resolveChatModel = (): ResolveModelResult => {
  const raw = process.env.CHAT_MODEL?.trim()
  const spec = raw && raw.length > 0 ? raw : DEFAULT_CHAT_MODEL

  const separator = spec.indexOf(':')
  if (separator <= 0 || separator === spec.length - 1) {
    return {
      status: 'error',
      message: `Invalid CHAT_MODEL '${spec}' — expected 'provider:model_id'`,
    }
  }

  const provider = spec.slice(0, separator)
  const modelId = spec.slice(separator + 1)
  return resolveProviderModel(provider, modelId)
}
