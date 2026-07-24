import { openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

import type { LlmModel } from '@/lib/ai/models'

/**
 * Server-only map from `llm_models.provider` to an AI SDK model factory.
 * Adding a provider = install its AI SDK package, add its API key, add one
 * entry here. Never import this module from client components.
 */
interface ProviderDefinition {
  requiredEnv: string
  createModel: (modelId: string) => LanguageModel
}

const PROVIDERS: Record<string, ProviderDefinition | undefined> = {
  openai: {
    requiredEnv: 'OPENAI_API_KEY',
    createModel: (modelId) => openai(modelId),
  },
}

/** Whether a catalog row's provider has a factory in this build. */
export const hasMappedProvider = (model: LlmModel): boolean =>
  PROVIDERS[model.provider] !== undefined

/** Catalog rows the current build can actually run (for the dropdown). */
export const filterMappedModels = (models: LlmModel[]): LlmModel[] =>
  models.filter(hasMappedProvider)

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

/**
 * Throwing wrapper over resolveProviderModel for the enrichment engine, which
 * catches the throw and folds it into its own error result.
 */
export const resolveLanguageModel = (model: LlmModel): LanguageModel => {
  const result = resolveProviderModel(model.provider, model.model_id)
  if (result.status === 'error') {
    throw new Error(result.message)
  }
  return result.model
}
