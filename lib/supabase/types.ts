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
          spotify_playlist_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          prompt?: string | null
          spotify_playlist_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string | null
          prompt?: string | null
          spotify_playlist_id?: string | null
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
          ai_attributes: Json | null
          ai_confidence: number | null
          album: string | null
          album_art_url: string | null
          apple_music_id: string | null
          artists: string[] | null
          artists_search: string | null
          duration_ms: number | null
          enriched_at: string | null
          enrichment_model: string | null
          enrichment_rank: number
          enrichment_status: string
          explicit: boolean | null
          id: string
          popularity: number | null
          release_date: string | null
          spotify_genres: string[] | null
          spotify_track_id: string
          title: string | null
        }
        Insert: {
          ai_attributes?: Json | null
          ai_confidence?: number | null
          album?: string | null
          album_art_url?: string | null
          apple_music_id?: string | null
          artists?: string[] | null
          artists_search?: string | null
          duration_ms?: number | null
          enriched_at?: string | null
          enrichment_model?: string | null
          enrichment_rank?: number
          enrichment_status?: string
          explicit?: boolean | null
          id?: string
          popularity?: number | null
          release_date?: string | null
          spotify_genres?: string[] | null
          spotify_track_id: string
          title?: string | null
        }
        Update: {
          ai_attributes?: Json | null
          ai_confidence?: number | null
          album?: string | null
          album_art_url?: string | null
          apple_music_id?: string | null
          artists?: string[] | null
          artists_search?: string | null
          duration_ms?: number | null
          enriched_at?: string | null
          enrichment_model?: string | null
          enrichment_rank?: number
          enrichment_status?: string
          explicit?: boolean | null
          id?: string
          popularity?: number | null
          release_date?: string | null
          spotify_genres?: string[] | null
          spotify_track_id?: string
          title?: string | null
        }
        Relationships: []
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
      log_unmatched_tags: {
        Args: { p_kind: string; p_names: string[] }
        Returns: undefined
      }
      songs_artists_search: { Args: { arr: string[] }; Returns: string }
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
