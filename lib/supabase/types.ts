/* eslint-disable */
// Generated from the live Supabase schema — do not edit by hand.
// Regenerate with: npm run gen:types (wraps supabase gen types + this header + prettier).
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      enrichment_recheck_limits: {
        Row: {
          last_requested_at: string
          request_count: number
          song_id: string
          user_id: string
        }
        Insert: {
          last_requested_at?: string
          request_count?: number
          song_id: string
          user_id: string
        }
        Update: {
          last_requested_at?: string
          request_count?: number
          song_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'enrichment_recheck_limits_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'enrichment_recheck_limits_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      enrichment_recipes: {
        Row: {
          created_at: string
          enabled: boolean
          enrichment_rank: number
          id: string
          identity_version: string
          is_default: boolean
          label: string
          model_id: string
          prompt_version: string
          recipe_key: string
          vocabulary_version: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          enrichment_rank: number
          id?: string
          identity_version: string
          is_default?: boolean
          label: string
          model_id: string
          prompt_version: string
          recipe_key: string
          vocabulary_version: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          enrichment_rank?: number
          id?: string
          identity_version?: string
          is_default?: boolean
          label?: string
          model_id?: string
          prompt_version?: string
          recipe_key?: string
          vocabulary_version?: string
        }
        Relationships: [
          {
            foreignKeyName: 'enrichment_recipes_model_id_fkey'
            columns: ['model_id']
            isOneToOne: false
            referencedRelation: 'llm_models'
            referencedColumns: ['id']
          },
        ]
      }
      genres: {
        Row: {
          created_at: string
          id: string
          is_approved: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_approved?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_approved?: boolean
          name?: string
        }
        Relationships: []
      }
      llm_models: {
        Row: {
          created_at: string
          enabled: boolean
          enrichment_rank: number
          id: string
          is_default: boolean
          label: string
          model_id: string
          provider: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          enrichment_rank?: number
          id?: string
          is_default?: boolean
          label: string
          model_id: string
          provider: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          enrichment_rank?: number
          id?: string
          is_default?: boolean
          label?: string
          model_id?: string
          provider?: string
          sort_order?: number
        }
        Relationships: []
      }
      moods: {
        Row: {
          created_at: string
          id: string
          is_approved: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_approved?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_approved?: boolean
          name?: string
        }
        Relationships: []
      }
      playlist_songs: {
        Row: {
          playlist_id: string
          position: number
          song_id: string
        }
        Insert: {
          playlist_id: string
          position: number
          song_id: string
        }
        Update: {
          playlist_id?: string
          position?: number
          song_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'playlist_songs_playlist_id_fkey'
            columns: ['playlist_id']
            isOneToOne: false
            referencedRelation: 'playlists'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'playlist_songs_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
        ]
      }
      playlists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string | null
          prompt: string | null
          spotify_checked_at: string | null
          spotify_image_url: string | null
          spotify_playlist_id: string | null
          spotify_status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          prompt?: string | null
          spotify_checked_at?: string | null
          spotify_image_url?: string | null
          spotify_playlist_id?: string | null
          spotify_status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          prompt?: string | null
          spotify_checked_at?: string | null
          spotify_image_url?: string | null
          spotify_playlist_id?: string | null
          spotify_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'playlists_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          spotify_user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          spotify_user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          spotify_user_id?: string | null
        }
        Relationships: []
      }
      song_enrichment_attempts: {
        Row: {
          ai_attributes: Json | null
          confidence: number | null
          created_at: string
          decided_at: string | null
          decision: string
          decision_reason: string | null
          expected_revision: number
          genre_names: string[]
          id: string
          job_id: string
          lease_token: string
          model_id: string
          mood_names: string[]
          outcome: string
          provider: string
          recipe_id: string
          recipe_rank: number
          song_id: string
        }
        Insert: {
          ai_attributes?: Json | null
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          decision?: string
          decision_reason?: string | null
          expected_revision: number
          genre_names?: string[]
          id?: string
          job_id: string
          lease_token: string
          model_id: string
          mood_names?: string[]
          outcome: string
          provider: string
          recipe_id: string
          recipe_rank: number
          song_id: string
        }
        Update: {
          ai_attributes?: Json | null
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          decision?: string
          decision_reason?: string | null
          expected_revision?: number
          genre_names?: string[]
          id?: string
          job_id?: string
          lease_token?: string
          model_id?: string
          mood_names?: string[]
          outcome?: string
          provider?: string
          recipe_id?: string
          recipe_rank?: number
          song_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'song_enrichment_attempts_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'song_enrichment_jobs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'song_enrichment_attempts_recipe_id_fkey'
            columns: ['recipe_id']
            isOneToOne: false
            referencedRelation: 'enrichment_recipes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'song_enrichment_attempts_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
        ]
      }
      song_enrichment_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          expected_revision: number | null
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          priority: number
          recipe_id: string
          request_count: number
          result_attempt_id: string | null
          song_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          expected_revision?: number | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          priority?: number
          recipe_id: string
          request_count?: number
          result_attempt_id?: string | null
          song_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          expected_revision?: number | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          priority?: number
          recipe_id?: string
          request_count?: number
          result_attempt_id?: string | null
          song_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'song_enrichment_jobs_recipe_id_fkey'
            columns: ['recipe_id']
            isOneToOne: false
            referencedRelation: 'enrichment_recipes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'song_enrichment_jobs_result_attempt_id_fkey'
            columns: ['result_attempt_id']
            isOneToOne: false
            referencedRelation: 'song_enrichment_attempts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'song_enrichment_jobs_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
        ]
      }
      song_genres: {
        Row: {
          genre_id: string
          song_id: string
        }
        Insert: {
          genre_id: string
          song_id: string
        }
        Update: {
          genre_id?: string
          song_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'song_genres_genre_id_fkey'
            columns: ['genre_id']
            isOneToOne: false
            referencedRelation: 'genres'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'song_genres_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
        ]
      }
      song_moods: {
        Row: {
          mood_id: string
          song_id: string
        }
        Insert: {
          mood_id: string
          song_id: string
        }
        Update: {
          mood_id?: string
          song_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'song_moods_mood_id_fkey'
            columns: ['mood_id']
            isOneToOne: false
            referencedRelation: 'moods'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'song_moods_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
        ]
      }
      songs: {
        Row: {
          active_enrichment_attempt_id: string | null
          ai_attributes: Json | null
          ai_confidence: number | null
          album: string | null
          album_art_url: string | null
          apple_music_id: string | null
          artists: string[] | null
          artists_search: string | null
          duration_ms: number | null
          enriched_at: string | null
          enrichment_attempts: number
          enrichment_model: string | null
          enrichment_rank: number
          enrichment_revision: number
          enrichment_skipped_rank: number
          enrichment_status: string
          explicit: boolean | null
          highest_attempted_recipe_id: string | null
          highest_attempted_recipe_rank: number
          id: string
          popularity: number | null
          release_date: string | null
          search_text: string | null
          spotify_genres: string[] | null
          spotify_track_id: string
          title: string | null
        }
        Insert: {
          active_enrichment_attempt_id?: string | null
          ai_attributes?: Json | null
          ai_confidence?: number | null
          album?: string | null
          album_art_url?: string | null
          apple_music_id?: string | null
          artists?: string[] | null
          artists_search?: string | null
          duration_ms?: number | null
          enriched_at?: string | null
          enrichment_attempts?: number
          enrichment_model?: string | null
          enrichment_rank?: number
          enrichment_revision?: number
          enrichment_skipped_rank?: number
          enrichment_status?: string
          explicit?: boolean | null
          highest_attempted_recipe_id?: string | null
          highest_attempted_recipe_rank?: number
          id?: string
          popularity?: number | null
          release_date?: string | null
          search_text?: string | null
          spotify_genres?: string[] | null
          spotify_track_id: string
          title?: string | null
        }
        Update: {
          active_enrichment_attempt_id?: string | null
          ai_attributes?: Json | null
          ai_confidence?: number | null
          album?: string | null
          album_art_url?: string | null
          apple_music_id?: string | null
          artists?: string[] | null
          artists_search?: string | null
          duration_ms?: number | null
          enriched_at?: string | null
          enrichment_attempts?: number
          enrichment_model?: string | null
          enrichment_rank?: number
          enrichment_revision?: number
          enrichment_skipped_rank?: number
          enrichment_status?: string
          explicit?: boolean | null
          highest_attempted_recipe_id?: string | null
          highest_attempted_recipe_rank?: number
          id?: string
          popularity?: number | null
          release_date?: string | null
          search_text?: string | null
          spotify_genres?: string[] | null
          spotify_track_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'songs_active_enrichment_attempt_id_fkey'
            columns: ['active_enrichment_attempt_id']
            isOneToOne: false
            referencedRelation: 'song_enrichment_attempts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'songs_highest_attempted_recipe_id_fkey'
            columns: ['highest_attempted_recipe_id']
            isOneToOne: false
            referencedRelation: 'enrichment_recipes'
            referencedColumns: ['id']
          },
        ]
      }
      spotify_tokens: {
        Row: {
          access_token: string
          expires_at: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          expires_at: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'spotify_tokens_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      unmatched_tags: {
        Row: {
          first_seen: string
          id: string
          kind: string
          last_seen: string
          name: string
          occurrences: number
        }
        Insert: {
          first_seen?: string
          id?: string
          kind: string
          last_seen?: string
          name: string
          occurrences?: number
        }
        Update: {
          first_seen?: string
          id?: string
          kind?: string
          last_seen?: string
          name?: string
          occurrences?: number
        }
        Relationships: []
      }
      user_genre_suppressions: {
        Row: {
          created_at: string
          genre_id: string
          song_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          genre_id: string
          song_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          genre_id?: string
          song_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_genre_suppressions_genre_id_fkey'
            columns: ['genre_id']
            isOneToOne: false
            referencedRelation: 'genres'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_genre_suppressions_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_genre_suppressions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_genres: {
        Row: {
          created_at: string
          genre_id: string
          song_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          genre_id: string
          song_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          genre_id?: string
          song_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_genres_genre_id_fkey'
            columns: ['genre_id']
            isOneToOne: false
            referencedRelation: 'genres'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_genres_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_genres_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_mood_suppressions: {
        Row: {
          created_at: string
          mood_id: string
          song_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          mood_id: string
          song_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          mood_id?: string
          song_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_mood_suppressions_mood_id_fkey'
            columns: ['mood_id']
            isOneToOne: false
            referencedRelation: 'moods'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_mood_suppressions_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_mood_suppressions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_moods: {
        Row: {
          created_at: string
          mood_id: string
          song_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          mood_id: string
          song_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          mood_id?: string
          song_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_moods_mood_id_fkey'
            columns: ['mood_id']
            isOneToOne: false
            referencedRelation: 'moods'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_moods_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_moods_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_songs: {
        Row: {
          imported_at: string
          liked_at: string | null
          song_id: string
          user_id: string
        }
        Insert: {
          imported_at?: string
          liked_at?: string | null
          song_id: string
          user_id: string
        }
        Update: {
          imported_at?: string
          liked_at?: string | null
          song_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_songs_song_id_fkey'
            columns: ['song_id']
            isOneToOne: false
            referencedRelation: 'songs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_songs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_song_enrichment_jobs: {
        Args: {
          p_lease_seconds: number
          p_lease_token: string
          p_limit: number
          p_user_id: string
        }
        Returns: {
          album: string
          artists: string[]
          expected_revision: number
          identity_version: string
          job_id: string
          lease_token: string
          model_id: string
          prompt_version: string
          provider: string
          recipe_id: string
          recipe_rank: number
          release_date: string
          song_id: string
          spotify_track_id: string
          title: string
          vocabulary_version: string
        }[]
      }
      confidence_band: {
        Args: { p_confidence: number; p_status: string }
        Returns: string
      }
      confidence_band_rank: { Args: { p_band: string }; Returns: number }
      enqueue_library_enrichment_jobs: {
        Args: { p_user_id: string }
        Returns: number
      }
      enrichment_attempts_remaining_at_rank: {
        Args: { p_recipe_rank: number; p_song_id: string }
        Returns: number
      }
      get_library_enrichment_counts: {
        Args: { p_user_id: string }
        Returns: {
          eligible: number
          high: number
          ineligible_weak: number
          low: number
          medium: number
          none: number
          pending: number
          queued: number
          total: number
        }[]
      }
      library_effective_tagged_songs: {
        Args: { p_kind: string; p_tag_ids: string[] }
        Returns: {
          song_id: string
        }[]
      }
      library_enrichment_counts: {
        Args: never
        Returns: {
          eligible: number
          high: number
          ineligible_weak: number
          low: number
          medium: number
          none: number
          pending: number
          queued: number
          total: number
        }[]
      }
      library_recheck_states: {
        Args: never
        Returns: {
          attempts_remaining: number
          song_id: string
          state: string
        }[]
      }
      library_search_page: {
        Args: {
          p_bands?: string[]
          p_genres?: string[]
          p_limit?: number
          p_moods?: string[]
          p_offset?: number
          p_terms?: string[]
          p_with_count?: boolean
        }
        Returns: {
          liked_at: string
          song_id: string
          total_count: number
        }[]
      }
      library_selectable_songs: {
        Args: never
        Returns: {
          liked_at: string
          song_id: string
        }[]
      }
      library_tag_names: {
        Args: never
        Returns: {
          id: string
          kind: string
          name: string
        }[]
      }
      library_tag_suggestions: {
        Args: { p_count_cap?: number; p_limit?: number; p_query?: string }
        Returns: {
          is_capped: boolean
          kind: string
          name: string
          song_count: number
        }[]
      }
      like_escape: { Args: { p_value: string }; Returns: string }
      log_unmatched_tags: {
        Args: { p_kind: string; p_names: string[] }
        Returns: undefined
      }
      next_enrichment_recipe: {
        Args: {
          p_ai_confidence: number
          p_enrichment_status: string
          p_highest_attempted_rank: number
          p_song_id: string
        }
        Returns: string
      }
      normalize_tag_name: { Args: { p_name: string }; Returns: string }
      playlist_tag_summary: {
        Args: never
        Returns: {
          kind: string
          name: string
          playlist_id: string
          song_count: number
        }[]
      }
      promote_song_enrichment_attempt: {
        Args: { p_attempt_id: string; p_job_id: string; p_lease_token: string }
        Returns: {
          decision: string
          is_promoted: boolean
          reason: string
        }[]
      }
      record_song_enrichment_attempt: {
        Args: {
          p_ai_attributes: Json
          p_confidence: number
          p_genre_names: string[]
          p_job_id: string
          p_lease_token: string
          p_mood_names: string[]
          p_outcome: string
        }
        Returns: string
      }
      record_song_enrichment_outcome: {
        Args: {
          p_ai_attributes?: Json
          p_confidence_text?: string
          p_genre_names?: string[]
          p_job_id: string
          p_lease_token: string
          p_mood_names?: string[]
          p_outcome: string
        }
        Returns: string
      }
      reject_stale_song_enrichment_attempt: {
        Args: { p_attempt_id: string; p_job_id: string; p_lease_token: string }
        Returns: boolean
      }
      release_song_enrichment_jobs: {
        Args: { p_job_ids: string[]; p_lease_token: string }
        Returns: number
      }
      request_song_enrichment_recheck: {
        Args: { p_song_id: string; p_user_id: string }
        Returns: string
      }
      retire_disabled_enrichment_jobs: {
        Args: { p_user_id: string }
        Returns: number
      }
      retry_failed_enrichment_jobs: {
        Args: { p_user_id: string }
        Returns: number
      }
      songs_artists_search: { Args: { arr: string[] }; Returns: string }
      sync_playlist_spotify_metadata: {
        Args: { p_playlists: Json }
        Returns: {
          missing_count: number
          present_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
