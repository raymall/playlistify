// Personal tags: the add/remove mutations behind /api/tags, plus the payload
// and response types shared with components/library-tag-editor.tsx.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'
import {
  ensureVocabularyIds,
  isValidTagName,
  normalizeTagName,
} from '@/lib/vocabulary'

export type TagKind = 'genre' | 'mood'

export type TagAddPayload = {
  operation: 'add'
  songId: string
  kind: TagKind
  name: string
}

export type TagRemovePayload = {
  operation: 'remove'
  songId: string
  kind: TagKind
  tagId: string
}

export type TagHidePayload = {
  operation: 'hide'
  songId: string
  kind: TagKind
  tagId: string
}

export type TagShowPayload = {
  operation: 'show'
  songId: string
  kind: TagKind
  tagId: string
}

export type TagAddResponse =
  | { status: 'ok'; tag: { id: string; name: string } }
  | { status: 'error'; message: string }

export type TagRemoveResponse =
  { status: 'ok' } | { status: 'error'; message: string }

export type TagSuppressionResponse =
  { status: 'ok' } | { status: 'error'; message: string }

const ownsSong = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  songId: string,
) => {
  const owned = await supabase
    .from('user_songs')
    .select('song_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('song_id', songId)
  if (owned.error !== null) {
    return { status: 'error' as const, message: owned.error.message }
  }
  return {
    status: 'ok' as const,
    isOwned: (owned.count ?? 0) > 0,
  }
}

/**
 * Personal tags run entirely on the RLS client: the vocabulary tables allow
 * authenticated INSERT, and user_genres/user_moods are owner-scoped FOR ALL —
 * no service role involved.
 */
export const addUserTag = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  { songId, kind, name }: TagAddPayload,
): Promise<TagAddResponse> => {
  const normalized = normalizeTagName(name)
  if (!isValidTagName(normalized)) {
    return { status: 'error', message: 'Invalid tag name' }
  }

  // The link-table RLS only checks user_id, so guard that the song is
  // actually in the caller's library before writing anything.
  const ownership = await ownsSong(supabase, userId, songId)
  if (ownership.status === 'error') return ownership
  if (!ownership.isOwned) {
    return { status: 'error', message: 'Song is not in your library' }
  }

  const table = kind === 'genre' ? 'genres' : 'moods'
  const vocabulary = await ensureVocabularyIds(supabase, table, [normalized])
  if (vocabulary.status === 'error') return vocabulary
  const tagId = vocabulary.idsByName.get(normalized)
  // Near-duplicate spellings snap onto the existing vocabulary, so echo the
  // canonical name the tag actually landed on rather than the raw input.
  const canonicalName = vocabulary.canonicalByName.get(normalized) ?? normalized
  if (tagId === undefined) {
    return { status: 'error', message: 'Tag could not be created' }
  }

  const link =
    kind === 'genre'
      ? await supabase
          .from('user_genres')
          .upsert(
            { user_id: userId, song_id: songId, genre_id: tagId },
            { onConflict: 'user_id,song_id,genre_id', ignoreDuplicates: true },
          )
      : await supabase
          .from('user_moods')
          .upsert(
            { user_id: userId, song_id: songId, mood_id: tagId },
            { onConflict: 'user_id,song_id,mood_id', ignoreDuplicates: true },
          )
  if (link.error) return { status: 'error', message: link.error.message }

  return { status: 'ok', tag: { id: tagId, name: canonicalName } }
}

export const removeUserTag = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  { songId, kind, tagId }: TagRemovePayload,
): Promise<TagRemoveResponse> => {
  const result =
    kind === 'genre'
      ? await supabase
          .from('user_genres')
          .delete()
          .eq('user_id', userId)
          .eq('song_id', songId)
          .eq('genre_id', tagId)
      : await supabase
          .from('user_moods')
          .delete()
          .eq('user_id', userId)
          .eq('song_id', songId)
          .eq('mood_id', tagId)
  if (result.error) return { status: 'error', message: result.error.message }

  return { status: 'ok' }
}

export const hideAiTag = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  { songId, kind, tagId }: TagHidePayload,
): Promise<TagSuppressionResponse> => {
  const ownership = await ownsSong(supabase, userId, songId)
  if (ownership.status === 'error') return ownership
  if (!ownership.isOwned) {
    return { status: 'error', message: 'Song is not in your library' }
  }

  const canonical =
    kind === 'genre'
      ? await supabase
          .from('song_genres')
          .select('song_id', { count: 'exact', head: true })
          .eq('song_id', songId)
          .eq('genre_id', tagId)
      : await supabase
          .from('song_moods')
          .select('song_id', { count: 'exact', head: true })
          .eq('song_id', songId)
          .eq('mood_id', tagId)
  if (canonical.error !== null) {
    return { status: 'error', message: canonical.error.message }
  }
  if ((canonical.count ?? 0) === 0) {
    return {
      status: 'error',
      message: 'Tag is not part of the shared analysis',
    }
  }

  const result =
    kind === 'genre'
      ? await supabase.from('user_genre_suppressions').upsert(
          { user_id: userId, song_id: songId, genre_id: tagId },
          {
            onConflict: 'user_id,song_id,genre_id',
            ignoreDuplicates: true,
          },
        )
      : await supabase.from('user_mood_suppressions').upsert(
          { user_id: userId, song_id: songId, mood_id: tagId },
          {
            onConflict: 'user_id,song_id,mood_id',
            ignoreDuplicates: true,
          },
        )
  if (result.error !== null) {
    return { status: 'error', message: result.error.message }
  }
  return { status: 'ok' }
}

export const showAiTag = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  { songId, kind, tagId }: TagShowPayload,
): Promise<TagSuppressionResponse> => {
  const ownership = await ownsSong(supabase, userId, songId)
  if (ownership.status === 'error') return ownership
  if (!ownership.isOwned) {
    return { status: 'error', message: 'Song is not in your library' }
  }

  const result =
    kind === 'genre'
      ? await supabase
          .from('user_genre_suppressions')
          .delete()
          .eq('user_id', userId)
          .eq('song_id', songId)
          .eq('genre_id', tagId)
      : await supabase
          .from('user_mood_suppressions')
          .delete()
          .eq('user_id', userId)
          .eq('song_id', songId)
          .eq('mood_id', tagId)
  if (result.error !== null) {
    return { status: 'error', message: result.error.message }
  }
  return { status: 'ok' }
}
