-- Playlistify initial schema: 12 tables + RLS + indexes.
-- Source of truth: MVP-PLAN.md §Database Schema and §Schema Notes.

-- ────────────────────────────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────────────────────────────

-- One row per user; id mirrors auth.users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  spotify_user_id text unique,
  display_name text,
  created_at timestamptz not null default now()
);

-- Server-side only (RLS enabled, zero policies → service role only).
-- Supabase does NOT refresh provider tokens; refresh_token is captured at
-- sign-in and the app runs its own refresh against Spotify.
create table public.spotify_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Global songs table, shared across all users. The unique key on
-- spotify_track_id IS the global enrichment cache: a song enriched for one
-- user is enriched for everyone, forever.
create table public.songs (
  id uuid primary key default gen_random_uuid(),
  spotify_track_id text unique not null,
  apple_music_id text,
  title text,
  artists text[],
  album text,
  album_art_url text,
  duration_ms integer,
  release_date date,
  popularity integer,
  explicit boolean,
  spotify_genres text[],
  ai_confidence numeric(3, 2),
  ai_attributes jsonb,
  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'enriched', 'unknown')),
  enrichment_model text,
  enriched_at timestamptz
);

-- Shared vocabulary tables. name is normalized (lowercased, trimmed) by the
-- app before writes; the same tag from two users or the AI = one row.
create table public.genres (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now()
);

create table public.moods (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now()
);

-- AI-inferred tag links, global song information.
create table public.song_genres (
  song_id uuid not null references public.songs (id) on delete cascade,
  genre_id uuid not null references public.genres (id) on delete cascade,
  primary key (song_id, genre_id)
);

create table public.song_moods (
  song_id uuid not null references public.songs (id) on delete cascade,
  mood_id uuid not null references public.moods (id) on delete cascade,
  primary key (song_id, mood_id)
);

-- User-added tag links, private to each user.
create table public.user_genres (
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  genre_id uuid not null references public.genres (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id, genre_id)
);

create table public.user_moods (
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  mood_id uuid not null references public.moods (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, song_id, mood_id)
);

-- Each user's library (join table).
create table public.user_songs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  liked_at timestamptz,
  imported_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

-- Playlists created through the app.
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  spotify_playlist_id text,
  name text,
  description text,
  prompt text,
  created_at timestamptz not null default now()
);

create table public.playlist_songs (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  song_id uuid not null references public.songs (id) on delete cascade,
  position integer not null,
  primary key (playlist_id, song_id)
);

-- ────────────────────────────────────────────────────────────────────────
-- Indexes beyond primary keys / unique constraints
-- ────────────────────────────────────────────────────────────────────────

-- Enrichment loop selects pending rows; ops queries count by status.
create index songs_enrichment_status_idx on public.songs (enrichment_status);

-- Reverse lookups: "songs with tag X" (search_library narrows by tag).
create index song_genres_genre_id_idx on public.song_genres (genre_id);
create index song_moods_mood_id_idx on public.song_moods (mood_id);

-- Playlist history is always fetched per user.
create index playlists_user_id_idx on public.playlists (user_id);

-- ────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.spotify_tokens enable row level security;
alter table public.songs enable row level security;
alter table public.genres enable row level security;
alter table public.moods enable row level security;
alter table public.song_genres enable row level security;
alter table public.song_moods enable row level security;
alter table public.user_genres enable row level security;
alter table public.user_moods enable row level security;
alter table public.user_songs enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_songs enable row level security;

-- profiles: users read their own row; all writes go through the service
-- role (auth callback).
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- spotify_tokens: NO policies on purpose — service role only.

-- Shared cache tables: readable by any signed-in user, written only by the
-- service role (import/enrichment pipelines).
create policy "songs_select_authenticated"
  on public.songs for select
  to authenticated
  using (true);

create policy "song_genres_select_authenticated"
  on public.song_genres for select
  to authenticated
  using (true);

create policy "song_moods_select_authenticated"
  on public.song_moods for select
  to authenticated
  using (true);

-- Vocabulary: readable by all signed-in users; inserts allowed (a junk tag
-- only surfaces for whoever linked it). No update/delete in the MVP.
create policy "genres_select_authenticated"
  on public.genres for select
  to authenticated
  using (true);

create policy "genres_insert_authenticated"
  on public.genres for insert
  to authenticated
  with check (true);

create policy "moods_select_authenticated"
  on public.moods for select
  to authenticated
  using (true);

create policy "moods_insert_authenticated"
  on public.moods for insert
  to authenticated
  with check (true);

-- Per-user tables: locked to the owning user.
create policy "user_songs_all_own"
  on public.user_songs for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_genres_all_own"
  on public.user_genres for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_moods_all_own"
  on public.user_moods for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "playlists_all_own"
  on public.playlists for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- playlist_songs has no user_id; access follows the owning playlist.
create policy "playlist_songs_all_own"
  on public.playlist_songs for all
  to authenticated
  using (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.playlists p
      where p.id = playlist_id and p.user_id = (select auth.uid())
    )
  );
