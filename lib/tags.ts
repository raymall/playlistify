import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/types'
import {
  ensureVocabularyIds,
  MAX_TAG_LENGTH,
  normalizeTagName,
} from '@/lib/vocabulary'

export type TagKind = 'genre' | 'mood'

/** Client → route request bodies. */
export interface TagAddPayload {
  songId: string
  kind: TagKind
  name: string
}

export interface TagRemovePayload {
  songId: string
  kind: TagKind
  tagId: string
}

export type TagAddResponse =
  | { status: 'ok'; tag: { id: string; name: string } }
  | { status: 'error'; message: string }

export type TagRemoveResponse =
  { status: 'ok' } | { status: 'error'; message: string }

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
  if (normalized.length === 0 || normalized.length > MAX_TAG_LENGTH) {
    return { status: 'error', message: 'Invalid tag name' }
  }

  // The link-table RLS only checks user_id, so guard that the song is
  // actually in the caller's library before writing anything.
  const owned = await supabase
    .from('user_songs')
    .select('song_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('song_id', songId)
  if (owned.error) return { status: 'error', message: owned.error.message }
  if ((owned.count ?? 0) === 0) {
    return { status: 'error', message: 'Song is not in your library' }
  }

  const table = kind === 'genre' ? 'genres' : 'moods'
  const vocabulary = await ensureVocabularyIds(supabase, table, [normalized])
  if (vocabulary.status === 'error') return vocabulary
  const tagId = vocabulary.idsByName.get(normalized)
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

  return { status: 'ok', tag: { id: tagId, name: normalized } }
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
