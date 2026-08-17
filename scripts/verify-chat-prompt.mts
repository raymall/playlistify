// Chat prompt verification: proves the assistant is shown the COMPLETE tag
// vocabulary of a library (nothing truncated), that every name it is shown is
// resolvable back to an id it can search with under exact matching, and that
// the candidate universe is Medium/High-or-personally-tagged and honors
// private AI-tag suppressions.
//
// The service-role client bypasses RLS, so this replicates the two RPCs'
// bodies scoped to one explicit user rather than calling them — same posture
// as verify-genres.mts.
//
// Usage: node --env-file=.env.local --import tsx scripts/verify-chat-prompt.mts
import { createClient } from '@supabase/supabase-js'

import type { LibraryTag } from '../lib/chat/library-search'
import { buildChatSystemPrompt } from '../lib/chat/prompt'
import type { Database } from '../lib/supabase/types'
import { normalizeTagName } from '../lib/vocabulary'
import { requireEnv } from './lib/env.mjs'
import { createChecker } from './lib/verify.mjs'

const [url, serviceKey] = requireEnv(
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  ' --import tsx',
)

const service = createClient<Database>(url, serviceKey)

/** `.in()` goes into the URL — keep each request well under the length limit. */
const IN_CHUNK = 100
/** Supabase REST caps responses at 1000 rows; page anything that can exceed it. */
const PAGE_SIZE = 1000

const { hard, hasFailed } = createChecker()

const chunk = <T,>(values: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size))
  }
  return out
}

const byName = (a: LibraryTag, b: LibraryTag): number =>
  a.name.localeCompare(b.name)

// Check the largest library — the worst case for truncation.
const countByUser = new Map<string, number>()
for (let from = 0; ; from += PAGE_SIZE) {
  const owners = await service
    .from('user_songs')
    .select('user_id, song_id')
    .order('user_id', { ascending: true })
    .order('song_id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1)
  if (owners.error) {
    console.error('Could not read user_songs:', owners.error.message)
    process.exit(1)
  }
  for (const row of owners.data) {
    countByUser.set(row.user_id, (countByUser.get(row.user_id) ?? 0) + 1)
  }
  if (owners.data.length < PAGE_SIZE) break
}
if (countByUser.size === 0) {
  console.log('SKIP  no libraries to check')
  process.exit(0)
}
const userId = [...countByUser.entries()].sort((a, b) => b[1] - a[1])[0][0]

const librarySongIds: string[] = []
const usableAiIds = new Set<string>()
const lowConfidenceIds = new Set<string>()
for (let from = 0; ; from += PAGE_SIZE) {
  const library = await service
    .from('user_songs')
    .select('song_id, songs!inner(enrichment_status, ai_confidence)')
    .eq('user_id', userId)
    .order('song_id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1)
  if (library.error) {
    console.error('Could not read library:', library.error.message)
    process.exit(1)
  }
  for (const row of library.data) {
    librarySongIds.push(row.song_id)
    if (
      row.songs.enrichment_status === 'enriched' &&
      row.songs.ai_confidence !== null &&
      row.songs.ai_confidence > 0.5
    ) {
      usableAiIds.add(row.song_id)
    } else if (row.songs.enrichment_status === 'enriched') {
      lowConfidenceIds.add(row.song_id)
    }
  }
  if (library.data.length < PAGE_SIZE) break
}

const [genreSuppressions, moodSuppressions] = await Promise.all([
  service
    .from('user_genre_suppressions')
    .select('song_id, genre_id')
    .eq('user_id', userId),
  service
    .from('user_mood_suppressions')
    .select('song_id, mood_id')
    .eq('user_id', userId),
])
if (genreSuppressions.error !== null || moodSuppressions.error !== null) {
  console.error('Could not read private tag suppressions')
  process.exit(1)
}
const hiddenGenres = new Set(
  genreSuppressions.data.map((row) => `${row.song_id}:${row.genre_id}`),
)
const hiddenMoods = new Set(
  moodSuppressions.data.map((row) => `${row.song_id}:${row.mood_id}`),
)

// Mirrors library_tag_names(): Medium/High AI links minus suppressions, unioned
// with the caller's own tags. Concrete per-table calls keep the types precise.
const readGenres = async (): Promise<LibraryTag[]> => {
  const byId = new Map<string, LibraryTag>()
  for (const ids of chunk([...usableAiIds], IN_CHUNK)) {
    const ai = await service
      .from('song_genres')
      .select('song_id, genre_id, genres!inner(id, name)')
      .in('song_id', ids)
    if (ai.error) throw new Error(ai.error.message)
    for (const row of ai.data) {
      if (hiddenGenres.has(`${row.song_id}:${row.genre_id}`)) continue
      byId.set(row.genres.id, row.genres)
    }
  }
  const personal = await service
    .from('user_genres')
    .select('genres!inner(id, name)')
    .eq('user_id', userId)
  if (personal.error) throw new Error(personal.error.message)
  for (const row of personal.data) byId.set(row.genres.id, row.genres)
  return [...byId.values()].sort(byName)
}

const readMoods = async (): Promise<LibraryTag[]> => {
  const byId = new Map<string, LibraryTag>()
  for (const ids of chunk([...usableAiIds], IN_CHUNK)) {
    const ai = await service
      .from('song_moods')
      .select('song_id, mood_id, moods!inner(id, name)')
      .in('song_id', ids)
    if (ai.error) throw new Error(ai.error.message)
    for (const row of ai.data) {
      if (hiddenMoods.has(`${row.song_id}:${row.mood_id}`)) continue
      byId.set(row.moods.id, row.moods)
    }
  }
  const personal = await service
    .from('user_moods')
    .select('moods!inner(id, name)')
    .eq('user_id', userId)
  if (personal.error) throw new Error(personal.error.message)
  for (const row of personal.data) byId.set(row.moods.id, row.moods)
  return [...byId.values()].sort(byName)
}

const [personalGenres, personalMoods] = await Promise.all([
  service.from('user_genres').select('song_id').eq('user_id', userId),
  service.from('user_moods').select('song_id').eq('user_id', userId),
])
if (personalGenres.error !== null || personalMoods.error !== null) {
  console.error('Could not read personal tags')
  process.exit(1)
}
const personallyTagged = new Set([
  ...personalGenres.data.map((row) => row.song_id),
  ...personalMoods.data.map((row) => row.song_id),
])

// Mirrors library_selectable_songs(): Medium/High OR personally tagged.
const selectable = new Set([...usableAiIds, ...personallyTagged])

const summary = {
  genres: await readGenres(),
  moods: await readMoods(),
  totalSongs: librarySongIds.length,
  selectableSongs: selectable.size,
}
const prompt = buildChatSystemPrompt(summary)

console.log(
  `INFO  library ${userId.slice(0, 8)}…: ${summary.totalSongs} songs, ` +
    `${summary.selectableSongs} selectable, ` +
    `${summary.genres.length} genres, ${summary.moods.length} moods`,
)

const kinds = [
  ['genres', summary.genres],
  ['moods', summary.moods],
] as const

// 1 + 2. Every name reaches the model, and nothing is elided. A truncated list
//        is a silently unsearchable slice of the library — the exact defect
//        that hid `rock` and `salsa` from the assistant.
for (const [kind, tags] of kinds) {
  const missing = tags.filter((tag) => !prompt.includes(tag.name))
  hard(
    `${kind}: every name appears in the prompt`,
    missing.length === 0,
    missing.length > 0
      ? `missing ${missing.length}: [${missing
          .slice(0, 8)
          .map((tag) => tag.name)
          .join(', ')}]`
      : `${tags.length} listed`,
  )
}
hard('prompt: no truncation marker', !prompt.includes(', …'))

// 3. Every listed name survives the normalization search_library applies to
//    the model's request, so an exact lookup finds it. Matching is exact, so a
//    denormalized row is shown to the model and then matches nothing — the
//    personal-tag case, now that free-form names go in unfiltered.
for (const [kind, tags] of kinds) {
  const unresolvable = tags
    .map((tag) => tag.name)
    .filter((name) => normalizeTagName(name) !== name)
  hard(
    `${kind}: every listed name is searchable`,
    unresolvable.length === 0,
    unresolvable.length > 0 ? `[${unresolvable.join(', ')}]` : '',
  )
}

// 4. Counts agree with the database, not with the code that built them.
const totalCount = await service
  .from('user_songs')
  .select('song_id', { count: 'exact', head: true })
  .eq('user_id', userId)
hard(
  'summary: total song count matches',
  totalCount.error === null && (totalCount.count ?? 0) === summary.totalSongs,
  `db=${totalCount.count ?? 0} summary=${summary.totalSongs}`,
)

// 5. The candidate universe is Medium/High OR personally tagged. Low AI tags
//    do not drive selection, but a personal tag still admits the song.
const taggedBelowMedium = [...personallyTagged].filter(
  (songId) => !usableAiIds.has(songId),
)
hard(
  'selectable index: covers every Medium/High song',
  [...usableAiIds].every((songId) => selectable.has(songId)),
  `medium-or-high=${usableAiIds.size}`,
)
hard(
  'selectable index: covers personally tagged Pending/None/Low songs',
  taggedBelowMedium.every((songId) => selectable.has(songId)),
  taggedBelowMedium.length === 0
    ? '(none personally tagged yet — vacuous today)'
    : `${taggedBelowMedium.length} tagged Pending/None/Low included`,
)
const lowWithoutPersonal = [...lowConfidenceIds].filter(
  (songId) => !personallyTagged.has(songId),
)
hard(
  'selectable index: excludes Low songs without personal tags',
  lowWithoutPersonal.every((songId) => !selectable.has(songId)),
  `low-without-personal=${lowWithoutPersonal.length}`,
)

console.log(
  hasFailed()
    ? '\nCHAT PROMPT CHECKS FAILED: see FAIL lines above.'
    : '\nCHAT PROMPT OK: the assistant sees every searchable tag in the library.',
)
process.exit(hasFailed() ? 1 : 0)
