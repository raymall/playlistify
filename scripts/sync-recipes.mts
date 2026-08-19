// Recipe snapshot sync: turns recipes/definitions.ts into enrichment_recipes
// rows. Hashes each definition together with a live snapshot of the approved
// vocabulary, inserts rows whose content hash the database has not seen, and
// activates exactly the enabled definitions through
// sync_enrichment_recipe_activation. Rows are never edited (only label,
// enabled, and is_default are mutable) — a changed definition mints a new
// recipe under a new hash.
//
// Dry-run by default: prints the full plan and writes nothing without --yes.
//
// Usage: npm run recipe:sync            (dry run)
//        npm run recipe:sync -- --yes   (apply)

import { createClient } from '@supabase/supabase-js'

import { type Database } from '@/lib/supabase/types'
import {
  RECIPE_DEFINITIONS,
  type RecipeDefinition,
} from '@/recipes/definitions'
import { requireEnv } from '@/scripts/lib/env.mjs'
import {
  buildRecipeKey,
  computeRecipeContentHash,
  loadApprovedVocabulary,
  readPromptText,
} from '@/scripts/lib/recipe-hash'

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

const isApply = process.argv.includes('--yes')

const service = createClient<Database>(url, serviceKey)

// Explicitly annotated so TS control-flow analysis treats calls as terminal.
const fail: (message: string) => never = (message) => {
  console.error(`ERROR  ${message}`)
  process.exit(1)
}

// --- Validate the definitions before touching anything. -------------------

const seenKeys = new Set<string>()
for (const definition of RECIPE_DEFINITIONS) {
  if (seenKeys.has(definition.key)) {
    fail(`duplicate definition key: ${definition.key}`)
  }
  seenKeys.add(definition.key)
  if (definition.isDefault && !definition.enabled) {
    fail(`default definition must be enabled: ${definition.key}`)
  }
  if (definition.batchSize < 1 || definition.batchSize > 50) {
    fail(`batchSize must be 1-50: ${definition.key}`)
  }
  if (definition.rank < 0 || !Number.isInteger(definition.rank)) {
    fail(`rank must be a non-negative integer: ${definition.key}`)
  }
}

const defaultDefinitions = RECIPE_DEFINITIONS.filter(
  (definition) => definition.isDefault,
)
if (defaultDefinitions.length !== 1) {
  fail(
    `exactly one definition must be isDefault (found ${defaultDefinitions.length})`,
  )
}

const enabledDefinitions = RECIPE_DEFINITIONS.filter(
  (definition) => definition.enabled,
)
const enabledKeysByRank = new Map<number, string[]>()
for (const definition of enabledDefinitions) {
  const rankKeys = enabledKeysByRank.get(definition.rank) ?? []
  rankKeys.push(definition.key)
  enabledKeysByRank.set(definition.rank, rankKeys)
}
for (const [rank, rankKeys] of enabledKeysByRank) {
  if (rankKeys.length > 1) {
    console.warn(
      `WARN  enabled recipes share rank ${rank}: ${rankKeys.join(', ')} — ` +
        'next_enrichment_recipe tiebreaks on recipe_key, which is a hash ' +
        'and therefore arbitrary among equals',
    )
  }
}

// --- Hash everything against the live approved vocabulary. ----------------

const vocabulary = await loadApprovedVocabulary(service)

type PlannedRecipe = {
  definition: RecipeDefinition
  systemPrompt: string
  contentHash: string
  recipeKey: string
}

const planned: PlannedRecipe[] = RECIPE_DEFINITIONS.map((definition) => {
  const systemPrompt = readPromptText(definition.promptFile)
  if (systemPrompt === '') fail(`empty prompt file: ${definition.promptFile}`)
  const contentHash = computeRecipeContentHash({
    provider: definition.provider,
    modelId: definition.modelId,
    reasoningEffort: definition.reasoningEffort,
    batchSize: definition.batchSize,
    systemPrompt,
    identityFields: definition.identityFields,
    outputSpec: definition.outputSpec,
    enrichmentRank: definition.rank,
    enrichAllSongs: definition.enrichAllSongs,
    vocabularyHash: vocabulary.contentHash,
  })
  return {
    definition,
    systemPrompt,
    contentHash,
    recipeKey: buildRecipeKey(definition.key, contentHash),
  }
})

const seenHashes = new Set<string>()
for (const plan of planned) {
  if (seenHashes.has(plan.contentHash)) {
    fail(`two definitions hash identically: ${plan.definition.key}`)
  }
  seenHashes.add(plan.contentHash)
}

// --- Read current state. ---------------------------------------------------

const modelRows = await service
  .from('llm_models')
  .select('id, provider, model_id')
if (modelRows.error !== null) {
  fail(`llm_models read failed: ${modelRows.error.message}`)
}
const modelIdByName = new Map(
  modelRows.data.map((row) => [`${row.provider}:${row.model_id}`, row.id]),
)
for (const plan of planned) {
  const modelName = `${plan.definition.provider}:${plan.definition.modelId}`
  if (!modelIdByName.has(modelName)) {
    fail(`no llm_models row for ${modelName} — add it in Studio first`)
  }
}

const recipeRows = await service
  .from('enrichment_recipes')
  .select('id, recipe_key, label, content_hash, enabled, is_default')
if (recipeRows.error !== null) {
  fail(`enrichment_recipes read failed: ${recipeRows.error.message}`)
}
const rowByHash = new Map(
  recipeRows.data.flatMap((row) =>
    row.content_hash === null ? [] : [[row.content_hash, row] as const],
  ),
)

const snapshotRow = await service
  .from('vocabulary_snapshots')
  .select('id')
  .eq('content_hash', vocabulary.contentHash)
  .maybeSingle()
if (snapshotRow.error !== null) {
  fail(`vocabulary_snapshots read failed: ${snapshotRow.error.message}`)
}

// --- Print the plan. ---------------------------------------------------------

console.log(
  `Vocabulary snapshot ${vocabulary.contentHash.slice(0, 12)}… ` +
    `(${vocabulary.genreNames.length} genres, ${vocabulary.moodNames.length} moods): ` +
    (snapshotRow.data === null ? 'new — will create' : 'exists — reused'),
)

for (const plan of planned) {
  const existing = rowByHash.get(plan.contentHash)
  const state = plan.definition.enabled
    ? plan.definition.isDefault
      ? 'enabled, default'
      : 'enabled'
    : 'disabled'
  if (existing === undefined) {
    console.log(
      `NEW    ${plan.recipeKey} (rank ${plan.definition.rank}, ${state})`,
    )
  } else {
    console.log(
      `KEEP   ${existing.recipe_key} (rank ${plan.definition.rank}, ${state})` +
        (existing.label === plan.definition.label
          ? ''
          : ` — label updates to "${plan.definition.label}"`),
    )
  }
}

const targetHashes = new Set(
  planned
    .filter((plan) => plan.definition.enabled)
    .map((plan) => plan.contentHash),
)
for (const row of recipeRows.data) {
  const isTargeted =
    row.content_hash !== null && targetHashes.has(row.content_hash)
  if (row.enabled && !isTargeted) {
    console.log(`OFF    ${row.recipe_key} — leaves the enabled set`)
  }
}

console.log(
  'NOTE   Queued jobs for recipes leaving the enabled set are retired and\n' +
    '       re-enqueued against the new default on the next "Analyze & improve"\n' +
    '       run. Minting at an unchanged rank grants no fresh analysis budget;\n' +
    '       only a higher-ranked recipe reopens finished songs.',
)

if (!isApply) {
  console.log('\nDry run — nothing written. Re-run with `-- --yes` to apply.')
  process.exit(0)
}

// --- Apply. -----------------------------------------------------------------

let snapshotId = snapshotRow.data?.id ?? null
if (snapshotId === null) {
  const inserted = await service
    .from('vocabulary_snapshots')
    .insert({
      label:
        `approved vocabulary · ${vocabulary.genreNames.length} genres · ` +
        `${vocabulary.moodNames.length} moods`,
      genre_names: vocabulary.genreNames,
      mood_names: vocabulary.moodNames,
      content_hash: vocabulary.contentHash,
    })
    .select('id')
    .single()
  if (inserted.error !== null) {
    fail(`vocabulary snapshot insert failed: ${inserted.error.message}`)
  }
  snapshotId = inserted.data.id
}

const activationIds: string[] = []
let defaultId: string | null = null

for (const plan of planned) {
  const existing = rowByHash.get(plan.contentHash)
  let recipeId: string
  if (existing === undefined) {
    const modelId = modelIdByName.get(
      `${plan.definition.provider}:${plan.definition.modelId}`,
    )
    if (modelId === undefined) {
      fail(`model disappeared mid-sync: ${plan.definition.key}`)
    }
    const inserted = await service
      .from('enrichment_recipes')
      .insert({
        model_id: modelId,
        recipe_key: plan.recipeKey,
        label: plan.definition.label,
        enrichment_rank: plan.definition.rank,
        reasoning_effort: plan.definition.reasoningEffort,
        batch_size: plan.definition.batchSize,
        enrich_all_songs: plan.definition.enrichAllSongs,
        enabled: false,
        is_default: false,
        system_prompt: plan.systemPrompt,
        identity_fields: plan.definition.identityFields,
        output_spec: plan.definition.outputSpec,
        vocabulary_snapshot_id: snapshotId,
        content_hash: plan.contentHash,
      })
      .select('id')
      .single()
    if (inserted.error !== null) {
      fail(
        `recipe insert failed (${plan.recipeKey}): ${inserted.error.message}`,
      )
    }
    recipeId = inserted.data.id
    console.log(`Inserted ${plan.recipeKey}`)
  } else {
    recipeId = existing.id
    if (existing.label !== plan.definition.label) {
      const updated = await service
        .from('enrichment_recipes')
        .update({ label: plan.definition.label })
        .eq('id', existing.id)
      if (updated.error !== null) {
        fail(
          `label update failed (${existing.recipe_key}): ${updated.error.message}`,
        )
      }
      console.log(`Relabeled ${existing.recipe_key}`)
    }
  }
  if (plan.definition.enabled) activationIds.push(recipeId)
  if (plan.definition.isDefault) defaultId = recipeId
}

if (defaultId === null) fail('no default recipe id resolved')

const activation = await service.rpc('sync_enrichment_recipe_activation', {
  p_recipe_ids: activationIds,
  p_default_id: defaultId,
})
if (activation.error !== null) {
  fail(`activation failed: ${activation.error.message}`)
}

console.log(
  `\nApplied: ${activationIds.length} enabled, default set. ` +
    'Run `npm run verify:recipes` to confirm.',
)
