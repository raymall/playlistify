# Architecture map

Agent-facing wayfinding index: where things live and which files implement
what. Kept deliberately compact — line-level detail lives in the linked files,
product/schema rationale in `MVP-PLAN.md`. Any change that adds, moves,
renames, or removes files, routes, tables, or env vars updates this file in
the same commit (rule in `AGENTS.md`).

## Directory map

- `app/` — App Router pages + route handlers; `app/globals.css` holds the
  theme tokens (light/dark CSS variables).
- `app/api/` — JSON route handlers for the client-driven batch loops
  (import, enrich, tags).
- `app/auth/` — OAuth callback + signout route handlers.
- `components/` — React components (kebab-case, one primary per file);
  `library-*.tsx` are the `/library` client panels.
- `components/ui/` — shadcn/ui primitives, built on `@base-ui/react` (not
  Radix). Touch only to restyle a primitive; add new ones via the shadcn CLI.
- `lib/ai/` — `models.ts` (reads over the `llm_models` catalog),
  `providers.ts` (server-only provider → AI SDK factory map;
  `resolveProviderModel` non-throwing + `resolveLanguageModel` throwing
  wrapper), `chat-model.ts` (resolves the chat model from the `CHAT_MODEL`
  env var, not the catalog).
- `lib/api/` — `route-helpers.ts`: shared JSON error response for the API
  routes (server-only).
- `lib/auth/` — `spotify.ts` (browser-side OAuth kick-off; scopes live here),
  `metadata.ts` (user_metadata narrowing).
- `lib/enrichment/` — `engine.ts` (batch enrichment: LLM call + all DB
  writes), `schema.ts` (zod output schema, confidence threshold,
  `ai_attributes` parser).
- `lib/spotify/` — `api.ts` (typed Web API client), `import.ts` (Liked Songs
  batch import), `token.ts` (Spotify access-token refresh).
- `lib/supabase/` — client factories + plumbing: `client.ts` (browser anon),
  `server.ts` (request-scoped RLS), `admin.ts` (service role), `session.ts`
  (proxy session refresh), `fetch.ts` (network-retry fetch), `env.ts` (public
  connection env guard), `types.ts` (generated — regenerate with
  `npm run gen:types`, never edit).
- `lib/tags.ts` / `lib/vocabulary.ts` — personal-tag mutations / shared
  genre-mood vocabulary (normalize, validate, fuzzy-snap, name→id). Two match
  paths: `matchApprovedVocabulary` (closed, `is_approved` rows only —
  enrichment) and `ensureVocabularyIds` (open, inserts — personal tags).
- `lib/json.ts` / `lib/sleep.ts` — shared JSON narrowing guards / abort-aware
  sleep (importable from server and client code).
- `scripts/` — Node ops + verification scripts (`npm run verify:*`,
  `gen:types`, `reset:enrichment`); each file's header comment says what it
  proves. Shared env guard in `scripts/lib/env.mjs`.
- `supabase/migrations/` — schema source of truth. Tables: `profiles`,
  `spotify_tokens`, `songs`, `genres`, `moods` (both with `is_approved` — the
  seeded, closed enrichment vocabulary), `song_genres`, `song_moods`,
  `user_genres`, `user_moods`, `user_songs`, `playlists`, `playlist_songs`,
  `llm_models`, `unmatched_tags` (review log of off-list enrichment tags,
  written via the `log_unmatched_tags` service-role RPC) (column detail:
  `MVP-PLAN.md` § Database Schema).
- `proxy.ts` — runs on every request: session refresh + route protection.
- Root: `MVP-PLAN.md` (product spec), `IMPROVEMENTS.md` (gitignored debt
  log), `README.md` (setup), `.env.example` (every env var, commented),
  `next.config.ts` (album-art image host allowlist).

## Route inventory

Pages — protected prefixes are `PROTECTED_PREFIXES` in `proxy.ts`:

- `/` — landing + "Continue with Spotify"; proxy redirects signed-in users
  to `/chat` (`app/page.tsx`, `components/spotify-sign-in-button.tsx`).
- `/library` — import panel, enrichment panel (model dropdown), searchable
  paginated table with per-song tag editor (`app/library/page.tsx` +
  `components/library-{import-panel,enrichment-panel,table,tag-editor}.tsx`).
- `/chat` — static placeholder; chat not built yet (`app/chat/page.tsx`).
- `/playlists` — static placeholder; not built yet (`app/playlists/page.tsx`).
- Chrome: `app/layout.tsx` — fonts, `ThemeProvider`, `SiteHeader` (nav,
  theme toggle, account menu with sign-out).

Route handlers — `/api/*` is not behind proxy protection; every handler
gates on `getUser()` itself:

- `GET /auth/callback` — exchanges the OAuth code, upserts `profiles`,
  captures Spotify provider tokens into `spotify_tokens`
  (`app/auth/callback/route.ts`).
- `POST /auth/signout` — clears the session, redirects to `/`
  (`app/auth/signout/route.ts`).
- `POST /api/import` — one Liked Songs batch, body `{offset}`
  (`app/api/import/route.ts` → `lib/spotify/import.ts`).
- `POST /api/enrich` — one enrichment batch, body `{modelId,
processedSoFar}`, `maxDuration` 300
  (`app/api/enrich/route.ts` → `lib/enrichment/engine.ts`).
- `POST|DELETE /api/tags` — add/remove one personal tag
  (`app/api/tags/route.ts` → `lib/tags.ts`).

## Core flows

**Auth + token refresh** — `components/spotify-sign-in-button.tsx` →
`lib/auth/spotify.ts` (browser OAuth start) → `app/auth/callback/route.ts`
(session exchange; writes `profiles` + `spotify_tokens` — the only place
provider tokens are captured). Every request thereafter: `proxy.ts` →
`lib/supabase/session.ts` refreshes the Supabase session cookie. Spotify
access tokens refresh on demand in `lib/spotify/token.ts`
(`getValidSpotifyToken`): service-role read of `spotify_tokens`, refresh
against Spotify near expiry; `invalid_grant` deletes the row so callers
surface the "reconnect Spotify" state.

**Import** — `components/library-import-panel.tsx` loops `POST /api/import`
until done. `lib/spotify/import.ts` fetches up to 2 pages of `/me/tracks`
through `lib/spotify/api.ts`, upserts metadata into `songs` (by
`spotify_track_id`; enrichment columns never touched, so re-sync can't reset
them) + `user_songs`. Artist-genre lookup degrades to `[]` on failure — the
batch `/artists` endpoint 403s for this app (divergence: MVP-PLAN assumes it
works).

**Enrichment** — `app/library/page.tsx` loads enabled `llm_models`
(`lib/ai/models.ts`, filtered by `lib/ai/providers.ts`) into
`components/library-enrichment-panel.tsx`; the panel loops `POST /api/enrich`
with the chosen model's row id. `lib/enrichment/engine.ts` selects ~20
pending songs (env caps `ENRICHMENT_BATCH_SIZE` /
`ENRICHMENT_MAX_SONGS_PER_RUN`), makes one structured-output call (AI SDK v7
`generateText` + `Output.object`; divergence: MVP-PLAN says SDK 5 /
`generateObject`). The vocabulary is **closed**: the prompt carries only
`is_approved` `genres`/`moods` rows and output resolves through
`matchApprovedVocabulary` (`lib/vocabulary.ts`) — snap onto an approved row
or drop. Dropped names are counted in `unmatched_tags` (via the
`log_unmatched_tags` RPC) for review; enrichment never inserts vocabulary
rows. Writes `song_genres`/`song_moods` and the `songs` enrichment columns.
Confidence < 0.4 (`lib/enrichment/schema.ts`) → `unknown`, no tags.

**Personal tags** — `components/library-tag-editor.tsx` → `/api/tags` →
`lib/tags.ts` on the RLS client: ownership check against `user_songs`,
vocabulary upsert via `lib/vocabulary.ts` (`ensureVocabularyIds` — the open
path; personal tags are not gated by `is_approved`), link rows in
`user_genres`/`user_moods`.

**Chat / selection** — not built yet — see MVP-PLAN.md step 7 (`/chat` is a
placeholder page).

**Playlist creation** — not built yet — see MVP-PLAN.md step 8 (`playlists` /
`playlist_songs` exist in the schema but nothing writes to them).

## Where does new code go

- Page → `app/<route>/page.tsx`; signed-in-only pages also add their prefix
  to `PROTECTED_PREFIXES` in `proxy.ts`.
- Route handler → `app/api/<name>/route.ts`; must gate on `getUser()` (proxy
  protection doesn't cover `/api`).
- Component → `components/<kebab-case>.tsx` (`'use client'` as low as
  possible); shadcn primitives → `components/ui/` via the CLI.
- Server/shared logic → `lib/<domain>/`; pick the Supabase client per its
  header (`server.ts` RLS vs `admin.ts` service role).
- New table / schema change → new file in `supabase/migrations/` +
  regenerated `lib/supabase/types.ts`, via the full sequence in
  `.claude/rules/database.md` (migration → push → gen:types → advisors →
  verify:rls → typecheck; commit migration + types together).
- Script → `scripts/*.mjs|mts` with a header comment + an npm script using
  `--env-file=.env.local`.
- Env var → `.env.local`, documented in `.env.example`; server-side only
  unless prefixed `NEXT_PUBLIC_`.
