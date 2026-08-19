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
- **Vercel AI SDK 7 (`ai` + `@ai-sdk/react`)** — recommended over hand-rolling the chat layer; see "Chat Layer Decision" below.

### Other

- **Spotify Web API** — library import (`/me/tracks`), saved-state confirmation (`/me/library/contains`), playlist create/list/update/unfollow. **Important:** audio features / recommendations endpoints are deprecated for new apps (Nov 2024), so LLM enrichment is the _only_ source of mood/energy data — it is the core of the product, not a nice-to-have. Artist genres were planned as a weak fallback signal, but the batch `GET /artists` endpoint returns 403 for this app; the import degrades to `[]` and continues, so `songs.spotify_genres` is empty for every row in practice and nothing reads it.
- **OpenAI API (default LLM provider)** — a small, cheap model for bulk
  enrichment; a stronger model for chat/selection. The system chooses an
  owner-curated enrichment recipe; users never select the model or rank that
  can mutate shared analysis. All calls use the AI SDK's provider-agnostic
  `LanguageModel` interface, so providers remain swappable.
- **Vercel (Hobby tier)** — hosting and deployment; first-class Next.js support, account already connected.

## Preferences

Stated by the user (treat as non-negotiable):

- Framework: Next.js. Database + auth: Supabase (must support Spotify OAuth). Components: shadcn/ui.
- Design: neo-Swiss — minimal, grid-driven, strong typography. Light and dark mode from day one.
- Enrichment is cached globally: each song has one canonical AI result across
  all users. Every band below `High` may be retried, three times per recipe
  rank; `High` only by a stronger recipe that sets `enrich_all_songs`. A retry
  replaces the canonical result only through the guarded
  promotion policy (product reasoning in `HOW-IT-WORKS.md`, mechanism in
  `ARCHITECTURE.md`).
- LLM provider must be swappable (OpenAI default, per user's choice).
- Songs table keyed for multi-platform: `spotify_track_id` now, nullable `apple_music_id` reserved.
- Songs are global; user libraries are a join table.

Decided during planning (user confirmed):

- Auth: **Spotify OAuth only** (email + password was considered on 2026-07-16 and reverted the same day — the product is unusable without a connected Spotify account, so a second auth method added a linking flow and edge cases with no MVP benefit).
- Import scope: **Liked Songs only** (not saved albums or playlists).
- Unknown songs: **mark as unknown**, no web-search fallback in the MVP.
  Unknown tracks get no trusted AI tags and are skipped by AI selection unless
  the user supplies personal tags. A strictly stronger analysis recipe may
  retry them through the guarded re-enrichment workflow.
- Hosting: **Vercel**.
- Enrichment recipe: **system-selected from an owner-curated catalog** (decision
  updated 2026-07-29). The earlier 2026-07-22 decision exposed the model picker
  to every user; the guarded global re-enrichment design supersedes it because
  a consumer should not choose the model, cost, or rank that mutates shared
  data. Models remain operational data in Supabase Studio; recipes add
  versioned prompt, vocabulary, and identity configuration on top.

## Chat Layer Decision: Vercel AI SDK 7 (recommended, not hand-rolled)

Use the AI SDK. Justification:

1. **It satisfies the swappable-provider requirement for free.** The SDK's unified `LanguageModel` interface means enrichment and chat code never import a vendor SDK directly — `openai('gpt-…')` vs `anthropic('claude-…')` is the only line that changes. Hand-rolling would mean writing and maintaining that abstraction yourself.
2. **`useChat` + `streamText` cover the hard UI problems** — SSE streaming, optimistic updates, message parts, and rendering of in-flight tool calls (exactly what's needed to show "searching your library…" while the model queries tracks).
3. **Tool calling is the right architecture for track selection** (see Schema Notes), and the SDK runs the multi-step tool loop natively.
4. **`generateText` with structured output** gives schema-validated JSON for
   the enrichment pipeline — no fragile JSON parsing of model output.

Hand-rolling only makes sense when the chat needs something the SDK can't express; nothing in this MVP qualifies.

## Feature List

**End-user:**

1. Sign in / sign out with Spotify (OAuth via Supabase Auth; scopes: `user-library-read`, `playlist-read-private`, `playlist-modify-public`, `playlist-modify-private`).
2. Import Liked Songs into the global songs table + personal library join table, with a visible progress indicator; re-sync on demand to pick up newly liked songs and, once a pass completes, drop songs Spotify confirms are no longer saved.
3. AI enrichment of every imported track (genres, moods, energy, era,
   descriptors + recognition confidence), batched, cached globally, resumable,
   with progress shown. The system chooses an owner-curated recipe, which also
   fixes the reasoning effort and batch size. Weak global results get three
   tries per recipe rank, and a strictly stronger recipe re-opens that budget;
   only a better candidate is promoted.
4. Library view: browse imported tracks with each track's AI attributes,
   model-reported Confidence band, the recipe behind it, and effective tags.
   Search runs in Postgres: free text over title + artists, AND-combined
   genre/mood filter pills fed by a library-scoped typeahead, OR-combined
   Confidence-band pills, exact counts, and
   full pagination. All search state lives in the URL.
5. Personal tags: add/remove your own moods and genres on any song in your
   library, and privately suppress an AI tag that should not affect your own
   playlists. Personal additions/suppressions never alter the global canonical
   result and are honored by playlist selection.
6. Conversational playlist creation: chat describing the desired playlist; AI queries the enriched library via tools, streams its reasoning, and proposes a track list.
7. Playlist preview: review the proposed tracks (with the AI's one-line rationale), remove tracks, regenerate.
8. Create the playlist in the user's Spotify account (name + description generated, editable before creation) and link to open it in Spotify.
9. Playlist management: list playlists created through the app; check whether
   each is still reachable in Spotify; mirror Spotify-authoritative titles,
   descriptions, and cover images; edit, delete, or recreate it; and show the
   effective genres and moods behind its songs.
10. Light/dark mode toggle (system default), neo-Swiss theme.

**Owner/operational (single developer — no admin UI, but must exist):**

11. Graceful Spotify re-auth: on `invalid_grant` / expired provider tokens, prompt the user to sign in with Spotify again (refresh tokens now expire after 6 months of inactivity).
12. Enrichment cost guardrails: per-run cap configurable via env var, batch
    size and reasoning effort fixed by the recipe; globally deduplicated jobs;
    bounded per-recipe omission attempts;
    enrichment progress and failures observable in Vercel logs / Supabase
    tables. Model/recipe catalogs remain owner-curated operational data in
    Supabase Studio — no admin UI.

## Views / Pages

1. **Landing / Login — `/`** — the Wake animated mesh, Playlistify wordmark, rotating liked-songs tagline, and "Continue with Spotify" button. The alternate Veil mesh remains available at `/v2` for comparison. Serves feature 1. Redirects signed-in users from `/` to `/library`.
2. **Import & Library — `/library`** — first-run: import/enrichment progress
   with system-selected analysis, which names the recipe it runs; afterwards: a
   search bar that commits
   free text, genre/mood filter pills, or Confidence-band pills, over a
   paginated table showing title,
   artist, AI/personal mood and genre chips, the Confidence band, and per-track
   controls to add personal tags and hide AI tags privately. There is no
   per-song re-analysis control — the recipe decides what runs.
   Includes Pending / None / Low / Medium / High confidence counts and
   "Re-sync Liked Songs".
   Serves features 2, 3, 4, 5.
3. **Chat — `/chat`** (the home screen once imported) — conversation pane with streaming responses and visible tool activity; proposed-playlist panel (track list with album art, per-track rationale, remove buttons); name/description fields; "Create playlist" button. Serves features 6, 7, 8.
4. **Playlists — `/playlists`** — management for created playlists: cached
   Spotify reachability and metadata with manual refresh, cover images,
   title/description editing, delete/unfollow, recreation from the stored
   songs, effective genre/mood summaries, and an "Open in Spotify" link when
   reachable. Serves feature 9.
5. **Global chrome** — top nav (Library / Chat / Playlists), theme toggle, account menu with sign-out and a re-connect-Spotify state for expired tokens. Serves features 1, 10, 11.

## Out of Scope

- Apple Music integration (only the nullable `apple_music_id` column exists).
- Importing saved albums or followed/owned playlists (Liked Songs only).
- Web-search fallback for unrecognized songs (marked `unknown` instead).
- Persisting chat history across sessions (a chat is ephemeral; only resulting playlists are saved).
- Email + password auth (considered and reverted: every feature requires a connected Spotify account anyway, so a second sign-in method only added an identity-linking flow and its edge cases; Spotify OAuth is the sole login).
- Admin UI for the model/recipe catalogs (`llm_models` and
  `enrichment_recipes` are edited directly in Supabase Studio). Adding a whole
  new LLM **provider** is still a code change (AI SDK provider package, API key,
  and mapping entry).
- User-facing reports of incorrect shared analysis. Private tag suppression is
  in scope; report collection, moderation, and use as a global review signal
  are deferred in `IMPROVEMENTS.md`.
- Vocabulary management (renaming/merging near-duplicate tags like "hip hop" vs "hip-hop") and the actual low-confidence cleanup job — `ai_confidence` exists precisely so that job is trivial later, but the MVP only records it.
- Public launch beyond Spotify development mode (max 25 allowlisted users) — extended quota is a separate, post-MVP battle.
- Admin dashboard, analytics, payments, email.

## Database Schema

All tables are in Supabase Postgres. `auth.users` is managed by Supabase Auth.
`supabase/migrations/` is the source of truth; this section is the annotated
reading of it. The guarded re-enrichment workflow's rationale is in
`HOW-IT-WORKS.md` and its mechanism in `ARCHITECTURE.md`.

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

| column                        | type                        | notes                                                                       |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| id                            | uuid PK                     |                                                                             |
| spotify_track_id              | text unique not null        |                                                                             |
| apple_music_id                | text nullable               | reserved for future                                                         |
| title                         | text                        |                                                                             |
| artists                       | text[]                      | display order                                                               |
| album                         | text                        |                                                                             |
| album_art_url                 | text                        |                                                                             |
| duration_ms                   | int                         |                                                                             |
| release_date                  | date                        |                                                                             |
| popularity                    | int                         | Spotify 0–100                                                               |
| explicit                      | boolean                     |                                                                             |
| spotify_genres                | text[]                      | intended artist-lookup fallback; always `[]` (see Stack → Spotify Web API)  |
| artists_search                | text                        | generated: artists joined for search                                        |
| search_text                   | text                        | generated: lowercased `title + artists`, behind a trigram GIN               |
| ai_confidence                 | numeric(3,2)                | rounded 0–1 recognition self-report                                         |
| ai_attributes                 | jsonb                       | energy (1–5), tempo_feel, era, instrumentation, descriptors[]               |
| enrichment_status             | text                        | `pending` \| `enriched` \| `unknown`                                        |
| enrichment_model              | text                        | provider/model snapshot that produced the canonical row                     |
| enrichment_rank               | smallint not null default 0 | rank of the recipe that produced the canonical row; 0 = never enriched      |
| enriched_at                   | timestamptz                 |                                                                             |
| active_enrichment_attempt_id  | uuid nullable               | accepted attempt; null means a legacy canonical result                      |
| enrichment_revision           | bigint not null default 0   | monotonic canonical snapshot revision                                       |
| highest_attempted_recipe_id   | uuid nullable               | highest-ranked recipe already attempted                                     |
| highest_attempted_recipe_rank | smallint not null default 0 | eligibility/cost guard independent of whether the latest candidate promoted |

`enrichment_rank` and `highest_attempted_recipe_rank` answer different
questions and both are load-bearing: the High opt-in gate compares the
_active_ rank, so a song keeps its full three tries at a new rank instead of
being closed out by its own first attempt.

**genres** / **moods** — shared vocabulary tables (identical shape)

| column      | type                 | notes                                                                                |
| ----------- | -------------------- | ------------------------------------------------------------------------------------ |
| id          | uuid PK              |                                                                                      |
| name        | text unique not null | normalized (lowercased, trimmed); same tag added by two users or by the AI = one row |
| is_approved | boolean not null     | closed enrichment vocabulary; personal tags may use unapproved names                 |
| created_at  | timestamptz          |                                                                                      |

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

**user_genre_suppressions** / **user_mood_suppressions** — AI tags hidden
privately by one user (identical shape)

| column             | type                | notes     |
| ------------------ | ------------------- | --------- |
| user_id            | uuid → profiles     | PK part 1 |
| song_id            | uuid → songs        | PK part 2 |
| genre_id / mood_id | uuid → genres/moods | PK part 3 |
| created_at         | timestamptz         |           |

**unmatched_tags** — off-list enrichment output, counted so real vocabulary
gaps can be reviewed deliberately (readable by any signed-in user; writes only
via the service-role `log_unmatched_tags` RPC)

| column                 | type        | notes                                  |
| ---------------------- | ----------- | -------------------------------------- |
| id                     | uuid PK     |                                        |
| kind                   | text        | `genre` \| `mood`                      |
| name                   | text        | normalized name the matcher threw away |
| occurrences            | int         | how often it has been produced         |
| first_seen / last_seen | timestamptz |                                        |

**user_songs** — each user's library (join table)

| column      | type            | notes                                        |
| ----------- | --------------- | -------------------------------------------- |
| user_id     | uuid → profiles | PK part 1                                    |
| song_id     | uuid → songs    | PK part 2                                    |
| liked_at    | timestamptz     | `added_at` from Spotify                      |
| imported_at | timestamptz     | last completed/resumable Spotify sync marker |

**playlists** — playlists created through the app

| column              | type            | notes                               |
| ------------------- | --------------- | ----------------------------------- |
| id                  | uuid PK         |                                     |
| user_id             | uuid → profiles |                                     |
| spotify_playlist_id | text            |                                     |
| name                | text            |                                     |
| description         | text            |                                     |
| prompt              | text            | the user's request that produced it |
| spotify_status      | text            | unknown, present, or missing        |
| spotify_checked_at  | timestamptz     | last reachability check             |
| spotify_image_url   | text            | temporary cover URL from Spotify    |
| created_at          | timestamptz     |                                     |

**playlist_songs**

| column      | type             | notes     |
| ----------- | ---------------- | --------- |
| playlist_id | uuid → playlists | PK part 1 |
| song_id     | uuid → songs     | PK part 2 |
| position    | int              |           |

**llm_models** — admin-curated provider/model catalog; rows are edited directly
in Supabase Studio (operational data, not schema)

| column     | type                           | notes                                                         |
| ---------- | ------------------------------ | ------------------------------------------------------------- |
| id         | uuid PK                        |                                                               |
| provider   | text not null                  | free text (`openai`, …); adding a provider needs no migration |
| model_id   | text not null                  | AI SDK model string, e.g. `gpt-5-mini`; unique per provider   |
| label      | text not null                  | owner-facing display name                                     |
| enabled    | boolean not null default true  | whether the model may back an active recipe                   |
| is_default | boolean not null default false | legacy model default, retained for compatibility              |
| sort_order | smallint not null default 0    | owner-facing ordering                                         |

| created_at | timestamptz | |

Ranking is not here: it is a property of the recipe, because two prompt or
vocabulary generations of one model can be ordered differently.

**enrichment_recipes** — complete frozen analysis snapshots, authored from
`recipes/definitions.ts` by `npm run recipe:sync`; only `label`, `enabled`,
and `is_default` are mutable (trigger-enforced)

| column                 | type                        | notes                                          |
| ---------------------- | --------------------------- | ---------------------------------------------- |
| id                     | uuid PK                     |                                                |
| model_id               | uuid → llm_models           | provider/model used                            |
| recipe_key             | text unique                 | `<definition key>:<content_hash prefix>`       |
| label                  | text                        | owner-facing name                              |
| system_prompt          | text                        | frozen prompt text (NULL on pre-snapshot rows) |
| identity_fields        | text[]                      | fields the song line is built from             |
| output_spec            | jsonb                       | bounded output caps/ranges, never JSON Schema  |
| vocabulary_snapshot_id | uuid → vocabulary_snapshots | frozen approved vocabulary                     |
| content_hash           | text unique                 | hash of the full snapshot + rank + opt-in      |
| reasoning_effort       | text                        | `minimal` \| `low` \| `medium` \| `high`       |
| batch_size             | smallint                    | songs per LLM call, 1–50                       |
| enrichment_rank        | smallint                    | authoritative sparse capability ordering       |
| enrich_all_songs       | boolean                     | may this recipe revisit `High` songs           |
| enabled / is_default   | boolean                     | one enabled default handles first-pass work    |
| created_at             | timestamptz                 |                                                |

A CHECK requires the five snapshot columns non-null whenever `enabled` is
true; the pre-snapshot rows keep NULLs (no backfill) and stay disabled.

**vocabulary_snapshots** — frozen approved-vocabulary copies recipes reference

| column                   | type        | notes                              |
| ------------------------ | ----------- | ---------------------------------- |
| id                       | uuid PK     |                                    |
| label                    | text        |                                    |
| genre_names / mood_names | text[]      | the approved lists as frozen       |
| content_hash             | text unique | hash of the two lists; sync reuses |
| created_at               | timestamptz |                                    |

**song_enrichment_jobs** — globally deduplicated, leased work queue

| column                          | type        | notes                                           |
| ------------------------------- | ----------- | ----------------------------------------------- |
| id                              | uuid PK     |                                                 |
| song_id / recipe_id             | uuid        | unique work identity                            |
| status                          | text        | `queued` \| `leased` \| `completed` \| `failed` |
| priority                        | int         | queue ordering, set at enqueue from the band    |
| attempt_count / next_attempt_at | int / time  | bounded omission retry and backoff              |
| lease_token / lease_expires_at  | uuid / time | crash-safe ownership                            |
| expected_revision               | bigint      | canonical revision observed at claim            |
| result_attempt_id               | uuid        | attempt that completed the job                  |
| created_at / updated_at         | timestamptz |                                                 |

**song_enrichment_attempts** — immutable per-song billable outcomes

| column                     | type        | notes                                                   |
| -------------------------- | ----------- | ------------------------------------------------------- |
| id / job_id / song_id      | uuid        | evidence identity                                       |
| recipe_id / recipe_rank    | uuid / int  | recipe plus immutable rank snapshot                     |
| lease_token                | uuid        | proves the worker that recorded the outcome             |
| provider / model_id        | text        | immutable provider/model snapshots                      |
| outcome                    | text        | `recognized` \| `unknown` \| `omitted` \| `failed`      |
| confidence / ai_attributes | number/json | candidate payload                                       |
| genre_names / mood_names   | text[]      | normalized approved candidate snapshot                  |
| expected_revision          | bigint      | canonical revision seen when claimed                    |
| decision / decision_reason | text        | one-way `pending` → `promoted` or `rejected` transition |
| created_at / decided_at    | timestamptz |                                                         |

### Schema Notes

- **Global enrichment cache is keyed by `songs.spotify_track_id`**: one
  canonical result is shared by every user. Every billable outcome is an
  immutable candidate attempt. The database locks and re-evaluates the latest
  song before atomically promoting a full attributes/genre/mood snapshot; a
  rejected candidate cannot alter canonical data.
- **Jobs deduplicate cost globally.** `(song_id, recipe_id)` is unique, claims
  use expiring leases, and the caller-issued lease token makes an ambiguous
  network retry return the original batch instead of claiming another. That
  token is required to record and promote an outcome. The public API never
  accepts a model, recipe, or rank from the browser.
- **One vocabulary, three user-visible layers.** `genres`/`moods` hold every
  normalized name once. `song_genres`/`song_moods` are canonical AI links,
  `user_genres`/`user_moods` are private additions, and suppression tables are
  private removals from the user's effective AI view. Personal additions win
  over same-name suppressions.
- **Shared cache is readable; operational evidence and private overlays are
  isolated by RLS.** Recipes, jobs, attempts, and Spotify tokens are
  service-role-only. User library/tag/suppression/playlist rows are locked to
  `user_id = auth.uid()`.
- **`ai_attributes` is jsonb on purpose**: the descriptor set will evolve; genres, moods, and confidence are promoted out of it because they're the SQL filter/cleanup targets.
- **Why tool calling for selection**: a few-thousand-track library doesn't fit
  in a chat context. The chat model gets a `search_library` tool and picks the
  final set from compact candidates. SQL narrows, the LLM curates.
- **Display and selection are two different effective-tag rules.** Both
  subtract the caller's suppressions and add the caller's personal tags, but
  chat selection also gates AI links on `ai_confidence > 0.5` while Library
  search and the tag typeahead apply no gate at all. A visible chip must find
  its own row; a Low result must not shape a playlist. The divergence is
  deliberate and load-bearing — see `ARCHITECTURE.md` § Constraints and
  invariants.
- **Enrichment remains a client-driven loop over a durable queue**: each
  authenticated request claims one leased same-recipe batch and returns
  progress. This stays inside serverless limits and is resumable without a
  scheduled worker.
- **Model and recipe rows are owner-operational data, not recurring migration
  seeds.** The additive migration took one legacy snapshot. New prompt,
  vocabulary, or identity revisions create a new recipe; they do not mutate the
  identity attached to old attempts. Studio is the usual place for that — the
  exception is a vocabulary revision, which cuts its replacement generation in
  the same migration that approves the new names.

## Implementation Plan

Status: steps 1–8 and 10–13 are shipped. Step 9 (hardening + deploy) is the
only remaining MVP work — the app has never been deployed to Vercel, and the
open hardening items are tracked in `IMPROVEMENTS.md`.

1. **Scaffold** — Next.js + TypeScript + Tailwind + shadcn/ui; neo-Swiss theme tokens (type scale, grid, light/dark CSS variables); nav shell and empty routes.
2. **Auth** — Supabase project; Spotify app registration; Supabase Auth Spotify provider with the four scopes; login/logout; capture `provider_token` + `provider_refresh_token` into `spotify_tokens` at sign-in; server-side helper that returns a valid access token (refreshing against Spotify when expired) and surfaces `invalid_grant` as a "reconnect Spotify" state.
3. **Schema** — migrations for the product, enrichment evidence/queue, private
   overlay tables, RLS policies, RPCs, constraints, and indexes.
4. **Import** — paginated `/me/tracks` fetch → upsert `songs` (Spotify metadata; the artist-genre lookup degrades to `[]`) + `user_songs`; completed re-syncs remove songs Spotify confirms are no longer liked; progress UI on `/library`.
5. **Enrichment** — AI SDK structured output; system-selected versioned
   recipes carrying their own reasoning effort and batch size; globally
   deduplicated leased jobs; immutable candidate attempts;
   transactional guarded promotion; bounded omissions/backoff; client batch
   loop and an env-var per-run spending cap.
6. **Personal tags** — Library tag editor for private additions/removals and
   explicit hide/show operations over canonical AI tags; effective-tag reads
   shared by Library and Chat.
7. **Chat** — AI SDK `streamText` + `useChat`; system prompt + `search_library` (AI tags OR the user's tags, confidence floor) and `propose_playlist` tools; streaming UI with tool-activity states; preview panel with remove/regenerate.
8. **Playlist creation and management** — create playlists and add tracks via
   Spotify; save the ordered snapshot to `playlists`/`playlist_songs`; manage
   reachability, details, deletion, recreation, and effective song-tag rollups
   from `/playlists`.
9. **Hardening + deploy** — empty/error/re-auth states, dark-mode pass, deploy to Vercel, test end-to-end with a real library.
10. **Guarded global re-enrichment (implemented 2026-07-29)** — versioned
    recipes, append-only attempts, globally deduplicated jobs, atomic candidate
    promotion, private AI-tag suppressions, system recipe selection, and
    outcome-centric recheck UX. Product reasoning lives in `HOW-IT-WORKS.md`,
    mechanism in `ARCHITECTURE.md`, and the executable policy matrix in
    `npm run verify:re-enrichment`.

11. **Database-side library search (implemented 2026-08-11)** — `pg_trgm` over a
    generated `songs.search_text`, an ordered `user_songs` index, one RPC that
    filters/counts/orders/pages in Postgres, a library-scoped tag typeahead,
    URL-owned search state, and full pagination.

12. **Capped re-analysis (implemented 2026-08-13)** — a widened mood vocabulary
    on a `vocabulary-v2` recipe generation, then three answers per recipe rank
    in place of one attempt per rank: `next_enrichment_recipe` as the single
    eligibility rule, a budget derived from the append-only attempts log,
    `Medium` made eligible while `High` is left alone, promotion reduced to an
    ordinal band comparison, same-rank retries re-opening their existing job,
    and a per-row control that analyzes one song on its own and shows the tries
    it has left.

13. **Recipe-driven enrichment (implemented 2026-08-15)** — the recipe becomes
    the only thing that decides what is analyzed and when. Reasoning effort and
    batch size move onto `enrichment_recipes` and are resolved inside the claim,
    so the browser has no enrichment authority beyond _when_ to run;
    `enrich_all_songs` lets a strictly stronger recipe revisit `High`, and only
    another `High` result may replace one. The per-song re-analysis control,
    its route, its single-song claim, and the request throttle are removed
    entirely, and the space they vacated is where the recipe becomes visible:
    `library_enrichment_recipes()` names the current one and any escalation,
    `library_song_recipes()` names the one behind each row. The legacy
    model-rank and omission columns are dropped.

Steps 4–6 and 7–8 are the two halves of the product; each is independently demoable.

## Risks & Open Questions

1. **Spotify development mode caps the app at 25 manually allowlisted users, and extended-quota approval has become very hard for new independent apps.** Fine for a personal MVP; a real launch depends on Spotify's approval process and should be treated as a separate project risk, not an engineering task.
2. **Provider token handling is the most likely place to lose days.** Supabase only reliably hands over `provider_refresh_token` at initial sign-in and never refreshes provider tokens itself — the app must store it immediately and run its own refresh. On top of that, Spotify refresh tokens now expire after 6 months of inactivity (new apps affected immediately; enforcement for existing apps from July 20, 2026), so `invalid_grant` → "sign in again" must be a designed flow, not an error page.
3. **Enrichment quality is unverifiable at scale.** The LLM may confuse songs with identical titles or hallucinate attributes for obscure tracks (audio-features endpoints are gone, so there's no ground truth to check against). Mitigations: always pass title + all artists + album + release year in the prompt, require a per-song confidence score (stored in `songs.ai_confidence` for future cleanup), and treat low confidence as `unknown` rather than trusting it. User tags are also a quiet corrective: where the AI is wrong, users can tag songs themselves and selection honors those tags.
