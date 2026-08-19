import { openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

/**
 * Server-only map from `llm_models.provider` to an AI SDK model factory.
 * Adding a provider = install its AI SDK package, add its API key, add one
 * entry here — including how it spells a reasoning effort, so a recipe's
 * effort is delivered rather than silently dropped for a non-openai provider.
 * Never import this module from client components.
 */
type EffortProviderOptions = Record<string, Record<string, string>>

type ProviderDefinition = {
  requiredEnv: string
  createModel: (modelId: string) => LanguageModel
  supportedEfforts: ReadonlySet<string>
  createEffortOptions: (reasoningEffort: string) => EffortProviderOptions
}

const PROVIDERS: Record<string, ProviderDefinition | undefined> = {
  openai: {
    requiredEnv: 'OPENAI_API_KEY',
    createModel: (modelId) => openai(modelId),
    supportedEfforts: new Set(['minimal', 'low', 'medium', 'high']),
    createEffortOptions: (reasoningEffort) => ({
      openai: { reasoningEffort },
    }),
  },
}

export type ResolveModelResult =
  { status: 'ok'; model: LanguageModel } | { status: 'error'; message: string }

/**
 * Resolve a provider + model id to an AI SDK model, or an error variant when
 * the provider isn't mapped in this build or its API key is missing. Non-
 * throwing — the chat path maps the error to an HTTP 503.
 */
export const resolveProviderModel = (
  provider: string,
  modelId: string,
): ResolveModelResult => {
  const definition = PROVIDERS[provider]
  if (definition === undefined) {
    return { status: 'error', message: `No provider mapping for '${provider}'` }
  }
  if (!process.env[definition.requiredEnv]) {
    return { status: 'error', message: `Missing ${definition.requiredEnv}` }
  }
  return { status: 'ok', model: definition.createModel(modelId) }
}

export type ResolveEffortResult =
  | { status: 'ok'; providerOptions: EffortProviderOptions }
  | { status: 'error'; message: string }

/**
 * Map a recipe's reasoning effort onto the provider's own option shape, or an
 * error variant when the provider isn't mapped or doesn't support the effort.
 * Non-throwing — the enrichment engine releases the batch for a safe retry,
 * because silently substituting a default would bill an answer the recipe
 * never asked for.
 */
export const resolveProviderEffortOptions = (
  provider: string,
  reasoningEffort: string,
): ResolveEffortResult => {
  const definition = PROVIDERS[provider]
  if (definition === undefined) {
    return { status: 'error', message: `No provider mapping for '${provider}'` }
  }
  if (!definition.supportedEfforts.has(reasoningEffort)) {
    return {
      status: 'error',
      message: `Provider '${provider}' has no effort '${reasoningEffort}'`,
    }
  }
  return {
    status: 'ok',
    providerOptions: definition.createEffortOptions(reasoningEffort),
  }
}
