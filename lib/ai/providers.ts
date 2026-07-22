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

export const resolveLanguageModel = (model: LlmModel): LanguageModel => {
  const definition = PROVIDERS[model.provider]
  if (definition === undefined) {
    throw new Error(`No provider mapping for '${model.provider}'`)
  }
  if (!process.env[definition.requiredEnv]) {
    throw new Error(`Missing ${definition.requiredEnv}`)
  }
  return definition.createModel(model.model_id)
}
