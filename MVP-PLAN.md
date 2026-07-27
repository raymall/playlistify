# Playlistify — MVP Plan

## Project Summary

Playlistify is a web app that turns a user's Spotify library into AI-generated playlists through a conversational interface. The user logs in with Spotify, the app imports their Liked Songs and enriches each track with AI-inferred attributes (genres, moods, descriptors), and the user then describes the playlist they want in natural language ("chill Sunday morning, nothing sad"). The AI selects matching tracks from the user's own enriched library and creates the playlist directly in their Spotify account.

## Goal

A user can log in with Spotify, watch their Liked Songs import and enrich, chat to describe a playlist, review the AI's track selection, and end up with a real playlist in their Spotify account — built only from songs they already saved. The MVP is done when that loop works end to end for a real library of a few thousand tracks, in light and dark mode, deployed on Vercel.

## Stack

### Tech

- **Next.js (App Router, TypeScript)** — user's chosen framework; route handlers serve the API, server components keep the library views fast.
- **Tailwind CSS + shadcn/ui** — user's chosen component layer; shadcn's CSS-variable theming gives light/dark mode and the neo-Swiss look with one token file.
- **Supabase (Postgres + Auth)** — user's chosen backend; Auth natively supports Spotify OAuth, Postgres holds the global songs table and per-user library, RLS isolates user data.
- **Vercel AI SDK 5 (`ai` + `@ai-sdk/react`)** — recommended over hand-rolling the chat layer; see Schema Notes → "Why AI SDK" below.

### Other

- **Spotify Web API** — library import (`/me/tracks`), artist genres, playlist creation. **Important:** audio features / recommendations endpoints are deprecated for new apps (Nov 2024), so LLM enrichment is the _only_ source of mood/energy data — it is the core of the product, not a nice-to-have.
- **OpenAI API (default LLM provider)** — a small, cheap model for bulk enrichment; a stronger model for the chat/selection step. The enrichment models offered to the user are admin-curated rows in the `llm_models` table; the user picks one per enrichment run. Swappable: all LLM calls go through the AI SDK's provider-agnostic `LanguageModel` interface, so switching to Anthropic (or others) is a config change, not a refactor.
- **Vercel (Hobby tier)** — hosting and deployment; first-class Next.js support, account already connected.

## Preferences

Stated by the user (treat as non-negotiable):

- Framework: Next.js. Database + auth: Supabase (must support Spotify OAuth). Components: shadcn/ui.
- Design: neo-Swiss — minimal, grid-driven, strong typography. Light and dark mode from day one.
- Enrichment is cached globally: each song analyzed by the LLM exactly once, ever, across all users.
- LLM provider must be swappable (OpenAI default, per user's choice).
- Songs table keyed for multi-platform: `spotify_track_id` now, nullable `apple_music_id` reserved.
- Songs are global; user libraries are a join table.

Decided during planning (user confirmed):

- Auth: **Spotify OAuth only** (email + password was considered on 2026-07-16 and reverted the same day — the product is unusable without a connected Spotify account, so a second auth method added a linking flow and edge cases with no MVP benefit).
- Import scope: **Liked Songs only** (not saved albums or playlists).
- Unknown songs: **mark as unknown**, no web-search fallback in the MVP. Unknown tracks get a low-confidence flag, are skipped by AI selection (Spotify artist genres remain as weak fallback data), and can be re-enriched later when a fallback is added behind the same interface.
- Hosting: **Vercel**.
- Enrichment model: **user-selectable per run** from an admin-curated list (decided 2026-07-22). The list lives in the `llm_models` table, edited directly in Supabase Studio — single admin = project owner, no admin UI, no in-app email gating. The choice is per-run, not persisted per user: enrichment is a one-time global cache per song, so the choice only affects still-pending songs.

## Chat Layer Decision: Vercel AI SDK 5 (recommended, not hand-rolled)

Use the AI SDK. Justification:

1. **It satisfies the swappable-provider requirement for free.** The SDK's unified `LanguageModel` interface means enrichment and chat code never import a vendor SDK directly — `openai('gpt-…')` vs `anthropic('claude-…')` is the only line that changes. Hand-rolling would mean writing and maintaining that abstraction yourself.
2. **`useChat` + `streamText` cover the hard UI problems** — SSE streaming, optimistic updates, message parts, and rendering of in-flight tool calls (exactly what's needed to show "searching your library…" while the model queries tracks).
3. **Tool calling is the right architecture for track selection** (see Schema Notes), and the SDK runs the multi-step tool loop natively.
4. **`generateObject`/structured output** gives schema-validated JSON for the enrichment pipeline — no fragile JSON parsing of model output.

Hand-rolling only makes sense when the chat needs something the SDK can't express; nothing in this MVP qualifies.

## Feature List

**End-user:**

1. Sign in / sign out with Spotify (OAuth via Supabase Auth; scopes: `user-library-read`, `playlist-modify-public`, `playlist-modify-private`).
2. Import Liked Songs into the global songs table + personal library join table, with a visible progress indicator; re-sync on demand to pick up newly liked songs.
3. AI enrichment of every imported track (genres, moods, energy, era, descriptors + confidence), batched, cached globally, resumable, with progress shown; the user picks the enrichment model per run from a dropdown of admin-enabled models (curated default preselected). Unknown songs flagged, never re-billed.
4. Library view: browse/search imported tracks, see each track's AI attributes, confidence, and enrichment status.
5. Personal tags: add/remove your own moods and genres on any song in your library. Tags are private to you (stored per-user), share one global deduplicated vocabulary with AI tags, and are honored by playlist selection alongside AI tags.
6. Conversational playlist creation: chat describing the desired playlist; AI queries the enriched library via tools, streams its reasoning, and proposes a track list.
7. Playlist preview: review the proposed tracks (with the AI's one-line rationale), remove tracks, regenerate.
8. Create the playlist in the user's Spotify account (name + description generated, editable before creation) and link to open it in Spotify.
9. Playlist history: list of playlists created through the app, each linking to Spotify.
10. Light/dark mode toggle (system default), neo-Swiss theme.

**Owner/operational (single developer — no admin UI, but must exist):**

11. Graceful Spotify re-auth: on `invalid_grant` / expired provider tokens, prompt the user to sign in with Spotify again (refresh tokens now expire after 6 months of inactivity).
12. Enrichment cost guardrails: batch size + per-run cap configurable via env vars; enrichment progress and failures observable in Vercel logs / Supabase table (query `enrichment_status` counts). Model catalog curated by editing the `llm_models` table in Supabase Studio (enable/disable models, set the default, order the dropdown) — no admin UI.

## Views / Pages

1. **Landing / Login — `/`** — one strong typographic statement of what the app does + "Continue with Spotify" button. Serves feature 1. Redirects signed-in users to `/chat`.
2. **Import & Library — `/library`** — first-run: import progress (tracks fetched → enriched, e.g. "1,204 / 3,882 enriched") with the pipeline running and a model dropdown in the enrichment panel (admin-enabled models, curated default preselected, disabled while a run is in progress); afterwards: searchable table/grid of the user's tracks showing title, artist, mood/genre chips (AI tags and the user's own tags, visually distinguished), confidence, enrichment status; per-track tag editor to add/remove personal moods and genres (combobox over the shared vocabulary + free entry); "Re-sync Liked Songs" button. Serves features 2, 3, 4, 5.
3. **Chat — `/chat`** (the home screen once imported) — conversation pane with streaming responses and visible tool activity; proposed-playlist panel (track list with album art, per-track rationale, remove buttons); name/description fields; "Create in Spotify" button. Serves features 6, 7, 8.
4. **Playlists — `/playlists`** — history of created playlists: name, prompt that produced it, track count, date, "Open in Spotify" link. Serves feature 9.
5. **Global chrome** — top nav (Library / Chat / Playlists), theme toggle, account menu with sign-out and a re-connect-Spotify state for expired tokens. Serves features 1, 10, 11.

## Out of Scope

- Apple Music integration (only the nullable `apple_music_id` column exists).
- Importing saved albums or followed/owned playlists (Liked Songs only).
- Web-search fallback for unrecognized songs (marked `unknown` instead).
- Persisting chat history across sessions (a chat is ephemeral; only resulting playlists are saved).
- Editing/updating a playlist after creation (create-only in MVP).
- Email + password auth (considered and reverted: every feature requires a connected Spotify account anyway, so a second sign-in method only added an identity-linking flow and its edge cases; Spotify OAuth is the sole login).
- Admin UI for the model catalog (`llm_models` is edited directly in Supabase Studio). Adding a whole new LLM **provider** is still a code change (AI SDK provider package + API key + mapping entry); adding/removing **models** of an existing provider is a Studio edit, and end users switch among enabled models in the enrichment panel.
- Vocabulary management (renaming/merging near-duplicate tags like "hip hop" vs "hip-hop") and the actual low-confidence cleanup job — `ai_confidence` exists precisely so that job is trivial later, but the MVP only records it.
- Public launch beyond Spotify development mode (max 25 allowlisted users) — extended quota is a separate, post-MVP battle.
- Admin dashboard, analytics, payments, email.

## Database Schema

All tables in Supabase Postgres. `auth.users` is managed by Supabase Auth.

**profiles** — one row per user

| column          | type        | notes                                          |
| --------------- | ----------- | ---------------------------------------------- |
| id              | uuid PK     | = `auth.users.id`                              |
| spotify_user_id | text unique | Spotify account id, needed to create playlists |
| display_name    | text        |                                                |
| created_at      | timestamptz |                                                |

**spotify_tokens** — server-side only (no client access via RLS)

| column        | type               | notes                                                                      |
| ------------- | ------------------ | -------------------------------------------------------------------------- |
| user_id       | uuid PK → profiles |                                                                            |
| access_token  | text               | short-lived                                                                |
| refresh_token | text               | captured at first login; Supabase does NOT refresh provider tokens for you |
| expires_at    | timestamptz        | access-token expiry                                                        |
| updated_at    | timestamptz        |                                                                            |

**songs** — global, shared across all users

| column            | type                        | notes                                                                                                                                                   |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                | uuid PK                     |                                                                                                                                                         |
| spotify_track_id  | text unique not null        |                                                                                                                                                         |
| apple_music_id    | text nullable               | reserved for future                                                                                                                                     |
| title             | text                        |                                                                                                                                                         |
| artists           | text[]                      | display order                                                                                                                                           |
| album             | text                        |                                                                                                                                                         |
| album_art_url     | text                        |                                                                                                                                                         |
| duration_ms       | int                         |                                                                                                                                                         |
| release_date      | date                        |                                                                                                                                                         |
| popularity        | int                         | Spotify 0–100                                                                                                                                           |
| explicit          | boolean                     |                                                                                                                                                         |
| spotify_genres    | text[]                      | from artist lookup (weak fallback signal)                                                                                                               |
| ai_confidence     | numeric(3,2)                | 0–1, LLM's self-reported recognition confidence; a real column (not buried in jsonb) so future cleanup/re-enrichment below a threshold is one SQL query |
| ai_attributes     | jsonb                       | energy (1–5), tempo_feel, era, instrumentation, descriptors[]                                                                                           |
| enrichment_status | text                        | `pending` \| `enriched` \| `unknown`                                                                                                                    |
| enrichment_model  | text                        | which model produced it                                                                                                                                 |
| enrichment_rank   | smallint not null default 0 | snapshot of that model's `enrichment_rank` at write time; 0 = never enriched. Re-enrichment requires a strictly higher rank                             |
| enriched_at       | timestamptz                 |                                                                                                                                                         |

**genres** / **moods** — shared vocabulary tables (identical shape)

| column     | type                 | notes                                                                                |
| ---------- | -------------------- | ------------------------------------------------------------------------------------ |
| id         | uuid PK              |                                                                                      |
| name       | text unique not null | normalized (lowercased, trimmed); same tag added by two users or by the AI = one row |
| created_at | timestamptz          |                                                                                      |

**song_genres** / **song_moods** — AI-inferred tags, global (identical shape)

| column             | type                | notes     |
| ------------------ | ------------------- | --------- |
| song_id            | uuid → songs        | PK part 1 |
| genre_id / mood_id | uuid → genres/moods | PK part 2 |

**user_genres** / **user_moods** — user-added tags, private to each user (identical shape)

| column             | type                | notes     |
| ------------------ | ------------------- | --------- |
| user_id            | uuid → profiles     | PK part 1 |
| song_id            | uuid → songs        | PK part 2 |
| genre_id / mood_id | uuid → genres/moods | PK part 3 |
| created_at         | timestamptz         |           |

**user_songs** — each user's library (join table)

| column      | type            | notes                   |
| ----------- | --------------- | ----------------------- |
| user_id     | uuid → profiles | PK part 1               |
| song_id     | uuid → songs    | PK part 2               |
| liked_at    | timestamptz     | `added_at` from Spotify |
| imported_at | timestamptz     |                         |

**playlists** — playlists created through the app

| column              | type            | notes                               |
| ------------------- | --------------- | ----------------------------------- |
| id                  | uuid PK         |                                     |
| user_id             | uuid → profiles |                                     |
| spotify_playlist_id | text            |                                     |
| name                | text            |                                     |
| description         | text            |                                     |
| prompt              | text            | the user's request that produced it |
| created_at          | timestamptz     |                                     |

**playlist_songs**

| column      | type             | notes     |
| ----------- | ---------------- | --------- |
| playlist_id | uuid → playlists | PK part 1 |
| song_id     | uuid → songs     | PK part 2 |
| position    | int              |           |

**llm_models** — admin-curated catalog of enrichment models; rows are edited directly in Supabase Studio (operational data, not schema)

| column          | type                           | notes                                                                                                     |
| --------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| id              | uuid PK                        |                                                                                                           |
| provider        | text not null                  | free text (`openai`, …); adding a provider needs no migration                                             |
| model_id        | text not null                  | AI SDK model string, e.g. `gpt-5-mini`; unique per provider                                               |
| label           | text not null                  | dropdown display name                                                                                     |
| enabled         | boolean not null default true  | only enabled rows are offered in the dropdown                                                             |
| is_default      | boolean not null default false | at most one (partial unique index); must be enabled (check)                                               |
| sort_order      | smallint not null default 0    | dropdown order                                                                                            |
| enrichment_rank | smallint not null default 0    | music-metadata recall ordering, sparse (100/200/300); unrelated to `sort_order`. Ties refuse (strict `>`) |
| created_at      | timestamptz                    |                                                                                                           |

### Schema Notes

- **Global enrichment cache is the unique constraint on `songs.spotify_track_id`**: before enriching, upsert by that key; only rows with `enrichment_status = 'pending'` ever reach the LLM. A song enriched for one user is enriched for everyone, forever.
- **One vocabulary, two link types.** `genres`/`moods` hold every tag name exactly once (unique on normalized name), whether it came from the AI or a user. `song_genres`/`song_moods` are the AI's links — global song information shared by everyone. `user_genres`/`user_moods` are a user's own links — visible only to that user and never part of the global song record. Adding a tag is upsert-vocabulary-by-name, then insert the user link.
- **`songs`, `genres`, `moods`, `song_genres`, `song_moods` are readable by all authenticated users (RLS)** — shared cache, nothing personal (vocabulary inserts allowed for authenticated users; a junk tag only surfaces for whoever linked it). `user_songs`, `user_genres`, `user_moods`, `playlists` are locked to `user_id = auth.uid()`; `spotify_tokens` is service-role only.
- **`ai_attributes` is jsonb on purpose**: the descriptor set will evolve; genres, moods, and confidence are promoted out of it because they're the SQL filter/cleanup targets.
- **Why tool calling for selection**: a few-thousand-track library doesn't fit in a chat context. The chat model gets a `search_library` tool (filters: moods, genres, energy range, era, exclude terms → compact candidate rows) and picks the final ~30 from candidates. SQL narrows, the LLM curates. The tool matches a tag if it's AI-linked **or** linked by the requesting user, and excludes `unknown`/low-confidence tracks.
- **Enrichment runs as a client-driven loop**: an authenticated route handler enriches one batch (~15–25 songs, one structured-output call) per invocation and returns progress; the import screen keeps calling it until done. This stays inside serverless time limits, is resumable by construction, and needs no queue infrastructure.
- **`llm_models` is admin-operational data, not schema**: readable by all authenticated users (RLS select only, no write policies — Studio/service role bypasses RLS). A partial unique index allows at most one `is_default = true` row and a check constraint forces the default row to be enabled, so swapping defaults in Studio is a two-step edit (clear the old default, then set the new one). Row content changes happen in Studio, never via migrations — only the table's shape is under migration control. If no default survives admin edits, the app falls back to the first enabled row by `sort_order`; if nothing is enabled, enrichment is unavailable and the panel says so.

## Implementation Plan

1. **Scaffold** — Next.js + TypeScript + Tailwind + shadcn/ui; neo-Swiss theme tokens (type scale, grid, light/dark CSS variables); nav shell and empty routes.
2. **Auth** — Supabase project; Spotify app registration; Supabase Auth Spotify provider with the three scopes; login/logout; capture `provider_token` + `provider_refresh_token` into `spotify_tokens` at sign-in; server-side helper that returns a valid access token (refreshing against Spotify when expired) and surfaces `invalid_grant` as a "reconnect Spotify" state.
3. **Schema** — migrations for all twelve tables + RLS policies + indexes (unique normalized name on `genres`/`moods`; PK/covering indexes on the link tables).
4. **Import** — paginated `/me/tracks` fetch → upsert `songs` (metadata + artist genres) + `user_songs`; re-sync; progress UI on `/library`.
5. **Enrichment** — AI SDK `generateObject` with a zod schema (genres, moods, attributes, confidence); batch route handler + client loop; upsert vocabulary rows and `song_genres`/`song_moods` links; write `ai_confidence`; `unknown` handling; env-var cost caps; library view shows attributes as they land. **Model selection** (foundation already in place: `llm_models` migration + seed + RLS + `lib/ai/models.ts`): the `/library` server page fetches enabled `llm_models` rows; the enrichment panel renders a labeled model dropdown (shadcn `Select`, added at this step) defaulting to the `is_default` row; every batch POST carries the chosen row's uuid; the route re-validates it against enabled rows server-side (never trusts a client model string — cost control), resolves the provider via a `lib/ai/providers.ts` map (`openai` → `@ai-sdk/openai`), filters out rows whose provider has no mapping, and writes `provider:model_id` into `songs.enrichment_model` for each song it enriches.
6. **Personal tags** — tag editor on `/library`: vocabulary combobox + free entry, upsert-by-name into `genres`/`moods`, insert/delete `user_genres`/`user_moods` rows.
7. **Chat** — AI SDK `streamText` + `useChat`; system prompt + `search_library` (AI tags OR the user's tags, confidence floor) and `propose_playlist` tools; streaming UI with tool-activity states; preview panel with remove/regenerate.
8. **Playlist creation** — create playlist + add tracks via Spotify API; save to `playlists`/`playlist_songs`; `/playlists` history page.
9. **Hardening + deploy** — empty/error/re-auth states, dark-mode pass, deploy to Vercel, test end-to-end with a real library.

Steps 4–6 and 7–8 are the two halves of the product; each is independently demoable.

## Risks & Open Questions

1. **Spotify development mode caps the app at 25 manually allowlisted users, and extended-quota approval has become very hard for new independent apps.** Fine for a personal MVP; a real launch depends on Spotify's approval process and should be treated as a separate project risk, not an engineering task.
2. **Provider token handling is the most likely place to lose days.** Supabase only reliably hands over `provider_refresh_token` at initial sign-in and never refreshes provider tokens itself — the app must store it immediately and run its own refresh. On top of that, Spotify refresh tokens now expire after 6 months of inactivity (new apps affected immediately; enforcement for existing apps from July 20, 2026), so `invalid_grant` → "sign in again" must be a designed flow, not an error page.
3. **Enrichment quality is unverifiable at scale.** The LLM may confuse songs with identical titles or hallucinate attributes for obscure tracks (audio-features endpoints are gone, so there's no ground truth to check against). Mitigations: always pass title + all artists + album + release year in the prompt, require a per-song confidence score (stored in `songs.ai_confidence` for future cleanup), and treat low confidence as `unknown` rather than trusting it. User tags are also a quiet corrective: where the AI is wrong, users can tag songs themselves and selection honors those tags.
