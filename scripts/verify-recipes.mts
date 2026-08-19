// Recipe snapshot verification: proves the database recipe catalog matches
// recipes/definitions.ts and that every stored snapshot is internally
// consistent — stored content hashes recompute from the stored fields, every
// enabled row carries a complete snapshot, and exactly the enabled
// definitions are enabled. Also reports (never fails on) drift between the
// live approved vocabulary and the newest frozen snapshot, which is the
// signal that approving tags has not taken effect until a new mint.
// Prints counts, keys, and hashes only — never prompt text or tag values.
//
// Usage: npm run verify:recipes

import { createClient } from '@supabase/supabase-js'

import { type Database } from '@/lib/supabase/types'
import { RECIPE_DEFINITIONS } from '@/recipes/definitions'
import { requireEnv } from '@/scripts/lib/env.mjs'
import {
  buildRecipeKey,
  canonicalize,
  computeRecipeContentHash,
  computeVocabularyHash,
  loadApprovedVocabulary,
  readPromptText,
} from '@/scripts/lib/recipe-hash'
import { createChecker } from '@/scripts/lib/verify.mjs'

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

const service = createClient<Database>(url, serviceKey)
const { hard, hasFailed } = createChecker()

const recipeRows = await service
  .from('enrichment_recipes')
  .select(
    'id, recipe_key, label, model_id, enrichment_rank, reasoning_effort, batch_size, enrich_all_songs, enabled, is_default, system_prompt, identity_fields, output_spec, vocabulary_snapshot_id, content_hash',
  )
if (recipeRows.error !== null) {
  console.error(`enrichment_recipes read failed: ${recipeRows.error.message}`)
  process.exit(1)
}

const snapshotRows = await service
  .from('vocabulary_snapshots')
  .select('id, genre_names, mood_names, content_hash, created_at')
if (snapshotRows.error !== null) {
  console.error(
    `vocabulary_snapshots read failed: ${snapshotRows.error.message}`,
  )
  process.exit(1)
}
const snapshotById = new Map(snapshotRows.data.map((row) => [row.id, row]))

const modelRows = await service
  .from('llm_models')
  .select('id, provider, model_id')
if (modelRows.error !== null) {
  console.error(`llm_models read failed: ${modelRows.error.message}`)
  process.exit(1)
}
const modelById = new Map(modelRows.data.map((row) => [row.id, row]))

// --- Catalog-wide invariants. -----------------------------------------------

const defaults = recipeRows.data.filter((row) => row.is_default)
hard(
  'at most one default recipe, and it is enabled',
  defaults.length <= 1 && defaults.every((row) => row.enabled),
  `defaults=${defaults.length}`,
)

const incompleteEnabled = recipeRows.data.filter(
  (row) =>
    row.enabled &&
    (row.system_prompt === null ||
      row.identity_fields === null ||
      row.output_spec === null ||
      row.vocabulary_snapshot_id === null ||
      row.content_hash === null),
)
hard(
  'every enabled recipe carries a complete snapshot',
  incompleteEnabled.length === 0,
  `incomplete=${incompleteEnabled.length}`,
)

// --- Stored hashes recompute from stored content. ----------------------------

let brokenSnapshotHashes = 0
for (const snapshot of snapshotRows.data) {
  const recomputed = computeVocabularyHash(
    snapshot.genre_names,
    snapshot.mood_names,
  )
  if (recomputed !== snapshot.content_hash) brokenSnapshotHashes += 1
}
hard(
  'vocabulary snapshot hashes recompute from stored names',
  brokenSnapshotHashes === 0,
  `broken=${brokenSnapshotHashes} snapshots=${snapshotRows.data.length}`,
)

let brokenRecipeHashes = 0
let hashedRows = 0
for (const row of recipeRows.data) {
  if (
    row.system_prompt === null ||
    row.identity_fields === null ||
    row.output_spec === null ||
    row.vocabulary_snapshot_id === null ||
    row.content_hash === null
  ) {
    continue
  }
  hashedRows += 1
  const snapshot = snapshotById.get(row.vocabulary_snapshot_id)
  const model = modelById.get(row.model_id)
  if (snapshot === undefined || model === undefined) {
    brokenRecipeHashes += 1
    continue
  }
  const recomputed = computeRecipeContentHash({
    provider: model.provider,
    modelId: model.model_id,
    reasoningEffort: row.reasoning_effort,
    batchSize: row.batch_size,
    systemPrompt: row.system_prompt,
    identityFields: row.identity_fields,
    outputSpec: row.output_spec,
    enrichmentRank: row.enrichment_rank,
    enrichAllSongs: row.enrich_all_songs,
    vocabularyHash: snapshot.content_hash,
  })
  if (recomputed !== row.content_hash) brokenRecipeHashes += 1
}
hard(
  'recipe content hashes recompute from stored snapshots',
  brokenRecipeHashes === 0,
  `broken=${brokenRecipeHashes} hashed=${hashedRows}`,
)

// --- The catalog matches the definitions. ------------------------------------

const matchesDefinition = (
  row: (typeof recipeRows.data)[number],
  definition: (typeof RECIPE_DEFINITIONS)[number],
  systemPrompt: string,
): boolean =>
  modelById.get(row.model_id)?.provider === definition.provider &&
  modelById.get(row.model_id)?.model_id === definition.modelId &&
  row.reasoning_effort === definition.reasoningEffort &&
  row.batch_size === definition.batchSize &&
  row.enrichment_rank === definition.rank &&
  row.enrich_all_songs === definition.enrichAllSongs &&
  row.system_prompt === systemPrompt &&
  row.identity_fields !== null &&
  canonicalize(row.identity_fields) ===
    canonicalize(definition.identityFields) &&
  row.output_spec !== null &&
  canonicalize(row.output_spec) === canonicalize(definition.outputSpec)

for (const definition of RECIPE_DEFINITIONS) {
  const systemPrompt = readPromptText(definition.promptFile)
  const prefixRows = recipeRows.data.filter((row) =>
    row.recipe_key.startsWith(`${definition.key}:`),
  )
  if (definition.enabled) {
    const enabledRows = prefixRows.filter((row) => row.enabled)
    const enabledRow = enabledRows.at(0)
    hard(
      `definition ${definition.key}: exactly one enabled row`,
      enabledRows.length === 1,
      `enabled=${enabledRows.length} minted=${prefixRows.length}`,
    )
    if (enabledRow !== undefined && enabledRows.length === 1) {
      hard(
        `definition ${definition.key}: enabled row matches the repo`,
        matchesDefinition(enabledRow, definition, systemPrompt),
        enabledRow.recipe_key,
      )
      hard(
        `definition ${definition.key}: default flag agrees`,
        enabledRow.is_default === definition.isDefault,
        `row=${enabledRow.is_default} definition=${definition.isDefault}`,
      )
      hard(
        `definition ${definition.key}: recipe_key carries its hash`,
        enabledRow.content_hash !== null &&
          enabledRow.recipe_key ===
            buildRecipeKey(definition.key, enabledRow.content_hash),
        enabledRow.recipe_key,
      )
    }
  } else {
    hard(
      `definition ${definition.key}: no row is enabled (definition disabled)`,
      prefixRows.every((row) => !row.enabled),
      `minted=${prefixRows.length}`,
    )
    hard(
      `definition ${definition.key}: a minted row matches the repo`,
      prefixRows.some((row) =>
        matchesDefinition(row, definition, systemPrompt),
      ),
      `minted=${prefixRows.length}`,
    )
  }
}

const enabledDefinitionKeys = RECIPE_DEFINITIONS.filter(
  (definition) => definition.enabled,
).map((definition) => definition.key)
const foreignEnabled = recipeRows.data.filter(
  (row) =>
    row.enabled &&
    !enabledDefinitionKeys.some((key) => row.recipe_key.startsWith(`${key}:`)),
)
hard(
  'no enabled recipe is outside the enabled definitions',
  foreignEnabled.length === 0,
  foreignEnabled.map((row) => row.recipe_key).join(', ') || 'none',
)

// --- Vocabulary drift: reported, never failed. --------------------------------

const liveVocabulary = await loadApprovedVocabulary(service)
const newestSnapshot = [...snapshotRows.data]
  .sort((a, b) => b.created_at.localeCompare(a.created_at))
  .at(0)
if (newestSnapshot === undefined) {
  console.log('INFO  no vocabulary snapshots exist yet — run recipe:sync')
} else if (newestSnapshot.content_hash === liveVocabulary.contentHash) {
  console.log(
    `INFO  live approved vocabulary matches the newest snapshot ` +
      `(${liveVocabulary.genreNames.length} genres, ` +
      `${liveVocabulary.moodNames.length} moods)`,
  )
} else {
  const frozenGenres = new Set(newestSnapshot.genre_names)
  const frozenMoods = new Set(newestSnapshot.mood_names)
  const addedGenres = liveVocabulary.genreNames.filter(
    (name) => !frozenGenres.has(name),
  ).length
  const addedMoods = liveVocabulary.moodNames.filter(
    (name) => !frozenMoods.has(name),
  ).length
  const liveGenres = new Set(liveVocabulary.genreNames)
  const liveMoods = new Set(liveVocabulary.moodNames)
  const removedGenres = newestSnapshot.genre_names.filter(
    (name) => !liveGenres.has(name),
  ).length
  const removedMoods = newestSnapshot.mood_names.filter(
    (name) => !liveMoods.has(name),
  ).length
  console.log(
    `WARN  live approved vocabulary has drifted from the newest snapshot: ` +
      `genres +${addedGenres}/-${removedGenres}, ` +
      `moods +${addedMoods}/-${removedMoods}. ` +
      'Approvals take effect only when recipe:sync mints new recipes.',
  )
}

console.log(
  hasFailed()
    ? '\nRECIPE SNAPSHOTS FAILED: see FAIL lines above.'
    : '\nRECIPE SNAPSHOTS OK: catalog matches the definitions and all hashes hold.',
)
process.exit(hasFailed() ? 1 : 0)
