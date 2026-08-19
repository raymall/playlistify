import { type EnrichmentOutputSpec } from '@/lib/enrichment/schema'

/**
 * The authored recipe catalog — the input `npm run recipe:sync` turns into
 * `enrichment_recipes` rows. Everything here except `label`, `enabled`, and
 * `isDefault` is part of the recipe's content hash: change any of it and the
 * sync mints a new row (`recipe_key = '<key>:<hash prefix>'`) instead of
 * editing the old one, because the database refuses to file the new hash as
 * the existing row. The approved vocabulary is snapshotted live at sync time
 * and freezes with the same hash, so approving a genre or mood takes effect
 * only when a new recipe is minted.
 *
 * `rank` is an explicit human decision — the sync never guesses it. Two
 * enabled recipes sharing a rank tiebreak on recipe_key, which is now a hash
 * and therefore arbitrary; the sync warns when that happens.
 */
export type RecipeDefinition = {
  /** Stable name; the minted recipe_key is `<key>:<contentHash[0:12]>`. */
  key: string
  label: string
  provider: string
  modelId: string
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
  batchSize: number
  rank: number
  enrichAllSongs: boolean
  enabled: boolean
  isDefault: boolean
  /** Repo-relative path; the file's trimmed text is the system prompt. */
  promptFile: string
  /** Formatter names from lib/enrichment/identity.ts, in prompt order. */
  identityFields: string[]
  outputSpec: EnrichmentOutputSpec
}

const ENRICHMENT_PROMPT_V1 = 'recipes/prompts/enrichment-v1.md'

const IDENTITY_FIELDS_V1 = ['title', 'artists', 'album', 'release_year']

/**
 * Mirrors the caps and ranges the prompt prose states — the schema is what
 * enforces them, the prompt is what explains them; keep the two in agreement.
 */
const OUTPUT_SPEC_V1: EnrichmentOutputSpec = {
  maxGenres: 4,
  maxMoods: 5,
  maxInstrumentation: 6,
  maxDescriptors: 8,
  energyMin: 1,
  energyMax: 5,
  tempoFeels: ['slow', 'mid', 'fast'],
}

export const RECIPE_DEFINITIONS: RecipeDefinition[] = [
  {
    key: 'openai:gpt-5.4-nano',
    label: 'GPT-5.4 nano — fastest, cheapest',
    provider: 'openai',
    modelId: 'gpt-5.4-nano',
    reasoningEffort: 'low',
    batchSize: 20,
    rank: 100,
    enrichAllSongs: false,
    enabled: true,
    isDefault: false,
    promptFile: ENRICHMENT_PROMPT_V1,
    identityFields: IDENTITY_FIELDS_V1,
    outputSpec: OUTPUT_SPEC_V1,
  },
  {
    key: 'openai:gpt-5.4-mini',
    label: 'GPT-5.4 mini — recommended',
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    reasoningEffort: 'low',
    batchSize: 20,
    rank: 200,
    enrichAllSongs: false,
    enabled: true,
    isDefault: true,
    promptFile: ENRICHMENT_PROMPT_V1,
    identityFields: IDENTITY_FIELDS_V1,
    outputSpec: OUTPUT_SPEC_V1,
  },
  {
    key: 'openai:gpt-5.4',
    label: 'GPT-5.4 — highest quality',
    provider: 'openai',
    modelId: 'gpt-5.4',
    reasoningEffort: 'low',
    batchSize: 20,
    rank: 300,
    enrichAllSongs: false,
    enabled: false,
    isDefault: false,
    promptFile: ENRICHMENT_PROMPT_V1,
    identityFields: IDENTITY_FIELDS_V1,
    outputSpec: OUTPUT_SPEC_V1,
  },
]
