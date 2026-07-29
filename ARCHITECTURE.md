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
  `library-*.tsx` are the `/library` client panels; `chat-screen.tsx`
  (chat state owner), `chat-conversation.tsx` (messages + composer), and
  `playlist-preview-panel.tsx` (proposal review + create) are the `/chat` UI.
- `components/ui/` — shadcn/ui primitives, built on `@base-ui/react` (not
  Radix). Touch only to restyle a primitive; add new ones via the shadcn CLI.
- `lib/ai/` — `models.ts` (reads over the `llm_models` catalog),
  `providers.ts` (server-only provider → AI SDK factory map;
  `resolveProviderModel` non-throwing + `resolveLanguageModel` throwing
  wrapper), `chat-model.ts` (resolves the chat model from the `CHAT_MODEL`
  env var, not the catalog).
- `lib/api/` — `route-helpers.ts`: shared JSON error response + `requireUser`,
  the auth gate every `/api/*` handler uses (server-only).
- `lib/auth/` — `spotify.ts` (browser-side OAuth kick-off; scopes live here),
  `metadata.ts` (user_metadata narrowing), `identity.ts` (the proxy-owned
  `x-auth-state` / `x-user-id` / `x-user-name` request headers + `hasAuthCookie`).
- `lib/chat/` — chat playlist assistant: `library-search.ts` (server-only
  RLS query layer — tag summary and selectable index over the
  `library_tag_names` / `library_selectable_songs` RPCs, link-table +
  candidate fetches), `tools.ts` (`createChatTools`: `search_library` +
  `propose_playlist` bound to the RLS client and the library vocabulary),
  `prompt.ts` (`buildChatSystemPrompt`), `contract.ts` (client-safe proposal +
  create-response parsers).
- `lib/enrichment/` — `engine.ts` (batch enrichment: LLM call + all DB
  writes), `schema.ts` (zod output schema, confidence threshold,
  `ai_attributes` parser), `rank.ts` (the strictly-outranks comparison that
  gates re-enrichment), `accuracy.ts` (client-safe: the five derived Accuracy
  bands and their confidence cuts).
- `lib/spotify/` — `api.ts` (typed Web API client), `import.ts` (Liked Songs
  batch import), `token.ts` (Spotify access-token refresh).
- `lib/supabase/` — client factories + plumbing: `client.ts` (browser anon),
  `server.ts` (request-scoped RLS), `admin.ts` (service role — importing it is
  lint-restricted to an allowlist in `eslint.config.mjs`), `session.ts`
  (proxy session refresh + identity headers), `auth.ts` (`isSessionDead` /
  `classifyNullUser`: tells a real logout apart from a token-rotation or
  network blip, and logs which), `fetch.ts` (network-retry fetch), `env.ts`
  (public connection env guard), `types.ts` (generated — regenerate with
  `npm run gen:types`, never edit).
- `lib/tags.ts` / `lib/vocabulary.ts` — personal-tag mutations / shared
  genre-mood vocabulary (normalize, validate, fuzzy-snap, name→id). Three
  match paths: `matchApprovedVocabulary` (closed, `is_approved` rows only —
  enrichment), `ensureVocabularyIds` (open, inserts — personal tags), and
  chat's `resolveTags` (`lib/chat/tools.ts`), which snaps via
  `snapToExistingName` against the library's own tags — approved or not — so
  the assistant can search every name the prompt showed it.
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
  written via the `log_unmatched_tags` service-role RPC). Chat reads through
  two security-invoker RPCs granted to `authenticated`: `library_tag_names()`
  (every genre/mood present in the caller's library, AI-linked or personally
  tagged) and `library_selectable_songs()` (the candidate universe — enriched
  OR personally tagged) (column detail:
  `MVP-PLAN.md` § Database Schema). `llm_models.enrichment_rank` orders models
  by music-metadata recall; `songs.enrichment_rank` snapshots the rank that
  wrote the row (0 = never enriched). `songs.enrichment_attempts` /
  `songs.enrichment_skipped_rank` track songs a model leaves out of its batch
  response — a write it never made, so they need their own pair of columns.
- `proxy.ts` — runs on every request: session refresh + route protection.
- Root: `MVP-PLAN.md` (product spec), `HOW-IT-WORKS.md` (plain-language
  product reasoning: enrichment, Accuracy bands, re-enrichment policy, chat →
  playlist), `IMPROVEMENTS.md` (gitignored debt log), `README.md` (setup),
  `.nvmrc` + `package.json#engines` (Node 24 runtime contract), `.env.example`
  (every env var, commented), `next.config.ts` (album-art image host
  allowlist).

## Route inventory

Pages — protected prefixes are `PROTECTED_PREFIXES` in `proxy.ts`:

- `/` — landing + "Continue with Spotify"; proxy redirects signed-in users
  to `/chat` (`app/page.tsx`, `components/spotify-sign-in-button.tsx`).
- `/library` — import panel, enrichment panel (model dropdown), searchable
  paginated table with an Accuracy band per song and a per-song tag editor
  (`app/library/page.tsx`, `app/library/loading.tsx` (instant skeleton
  streamed while the page's queries run) +
  `components/library-{import-panel,enrichment-panel,table,tag-editor,accuracy-info}.tsx`).
- `/chat` — describe a playlist; conversation streams beside a live preview
  panel (rename, edit, drop tracks, create). Server-rendered empty states for
  no-library / not-yet-enriched (`app/chat/page.tsx` + `components/chat-*`,
  `components/playlist-preview-panel.tsx`).
- `/playlists` — created-playlist history: name, track count, date, prompt,
  "Open in Spotify" link (`app/playlists/page.tsx`). Read-only, minimal.
- Chrome: `app/layout.tsx` — fonts, `ThemeProvider`, `SiteHeader` (nav,
  theme toggle, account menu with sign-out). `AccountMenu` renders on every
  page, so it reads the identity the proxy already resolved off `x-auth-state`
  rather than calling `getUser()` a second time.

Route handlers — `/api/*` is not behind proxy protection; every handler gates
on `getUser()` itself, through the shared `requireUser` helper
(`lib/api/route-helpers.ts`). It answers 401 only for a provably dead session;
an auth service that merely blinked is a 503 the client may retry for free:

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
- `POST /api/playlists` — create a playlist from a curated proposal, body
  `{name, description, songIds, prompt}`
  (`app/api/playlists/route.ts` → `lib/playlists/create.ts`).
- `POST /api/chat` — streaming chat, body `{messages}` (UIMessage[]),
  `maxDuration` 300 (`app/api/chat/route.ts` → `lib/chat/*`).

## Core flows

**Auth + token refresh** — `components/spotify-sign-in-button.tsx` →
`lib/auth/spotify.ts` (browser OAuth start) → `app/auth/callback/route.ts`
(session exchange; writes `profiles` + `spotify_tokens` — the only place
provider tokens are captured). Every request thereafter: `proxy.ts` →
`lib/supabase/session.ts` refreshes the Supabase session cookie and forwards
the resolved caller to the render on `x-auth-state` (+ `x-user-id` /
`x-user-name` when signed in), so no page or layout re-derives it. Spotify
access tokens refresh on demand in `lib/spotify/token.ts`
(`getValidSpotifyToken`): service-role read of `spotify_tokens`, refresh
against Spotify near expiry; `invalid_grant` deletes the row so callers
surface the "reconnect Spotify" state.

**Import** — `components/library-import-panel.tsx` loops `POST /api/import`
until done, riding out `safeToRetry` failures (`MAX_SAFE_RETRIES`) instead of
pausing. `lib/spotify/import.ts` fetches up to 2 pages of `/me/tracks`
through `lib/spotify/api.ts`, upserts metadata into `songs` (by
`spotify_track_id`; enrichment columns never touched, so re-sync can't reset
them) + `user_songs`. The `SongMetadata` alias pins that payload to the nine
Spotify columns, and `EnrichmentWrite` (`lib/enrichment/engine.ts`) pins the
other side — the two writers cannot reach each other's columns without a
compile error. Artist-genre lookup degrades to `[]` on failure — the
batch `/artists` endpoint 403s for this app (divergence: MVP-PLAN assumes it
works).

**Enrichment** — `app/library/page.tsx` loads enabled `llm_models`
(`lib/ai/models.ts`, filtered by `lib/ai/providers.ts`) into
`components/library-enrichment-panel.tsx`; the panel loops `POST /api/enrich`
with the chosen model's row id. `lib/enrichment/engine.ts` selects ~20 songs,
newest-liked first (env caps `ENRICHMENT_BATCH_SIZE` /
`ENRICHMENT_MAX_SONGS_PER_RUN`): `pending` rows first, then — only if the batch
isn't full — _improvable_ ones, meaning None/Low rows
(`IMPROVABLE_SONGS_FILTER` in `lib/enrichment/accuracy.ts`) whose
`enrichment_rank` is strictly below the selected model's. Medium and High are
finished; same-or-weaker model refuses. That rank gate is half of what makes the
run terminate: every write raises the row to the model's rank, so a song is
picked at most once per run.

The other half covers songs the model **omits** from its response. Those get no
write at all, so rank can't retire them; instead `recordOmissions` counts each
one in `songs.enrichment_attempts`, and at `MAX_ENRICHMENT_ATTEMPTS`
(`lib/enrichment/rank.ts`) stamps `songs.enrichment_skipped_rank` with the
model's rank and resets the counter. Both selector passes and the pending count
carry `enrichment_skipped_rank < model rank`, so the song stops being sent until
a strictly stronger model asks — and a fresh allowance starts when one does. Any
successful write clears both columns. The bookkeeping is best-effort
(`console.error`, never fails the batch), because the batch is already billed by
the time it runs; the panel's `MAX_STALLED_BATCHES` guard stays as a client-side
backstop. It then makes one structured-output call (AI SDK v7
`generateText` + `Output.object`; divergence: MVP-PLAN says SDK 5 /
`generateObject`). The vocabulary is **closed**: the prompt carries only
`is_approved` `genres`/`moods` rows and output resolves through
`matchApprovedVocabulary` (`lib/vocabulary.ts`) — snap onto an approved row
or drop. Dropped names are counted in `unmatched_tags` (via the
`log_unmatched_tags` RPC) for review; enrichment never inserts vocabulary
rows. Writes `song_genres`/`song_moods` and the `songs` enrichment columns.
Confidence < 0.4 (`lib/enrichment/schema.ts`) → `unknown`, no tags — the flip
also deletes any links a crashed earlier attempt left on that song.

**Personal tags** — `components/library-tag-editor.tsx` → `/api/tags` →
`lib/tags.ts` on the RLS client: ownership check against `user_songs`,
vocabulary upsert via `lib/vocabulary.ts` (`ensureVocabularyIds` — the open
path; personal tags are not gated by `is_approved`), link rows in
`user_genres`/`user_moods`. A personal tag also makes its song selectable in
chat even when enrichment never recognized it (`library_selectable_songs`),
though such a song carries no `ai_attributes` and so fails energy/era filters.

**Chat / selection** — `components/chat-screen.tsx` (`useChat` +
`DefaultChatTransport`) streams to `POST /api/chat`. The route fetches one
`getLibraryTagSummary` and uses it twice: to build the library-grounded system
prompt (`lib/chat/prompt.ts`) and to bound what `search_library` may resolve,
so the assistant searches exactly the vocabulary it was shown. The tag lists
in the prompt are **complete, never sampled** — a truncated list is a silently
unsearchable slice of the library. Then `streamText` with a `stepCountIs(8)`
tool loop. `search_library` (`lib/chat/tools.ts`) resolves requested tags
against that vocabulary (`resolveTags`, fuzzy-snapping via
`snapToExistingName`), unions AI + user link tables per kind and intersects
across kinds, intersects with the selectable index (recency), scans ≤1000,
TS-post-filters by energy/era/exclude, and returns ≤80 candidates.
`propose_playlist` verifies ownership and returns the preview payload. The
proposal renders ONLY in `components/playlist-preview-panel.tsx`, never as
chat text (prompt- and renderer-enforced).

**Playlist creation** — the preview panel POSTs a curated proposal to
`/api/playlists` → `lib/playlists/create.ts` (`createPlaylistForUser`, RLS
client): resolves song ids → Spotify track ids scoped by RLS, refreshes the
token (`lib/spotify/token.ts`), creates a private playlist via
`POST /me/playlists` and adds tracks in chunks (`lib/spotify/api.ts`), then
persists `playlists` + `playlist_songs`.
Failure policy: pre-Spotify failures create nothing (clean
error/reconnect/rate-limited); an add-tracks failure keeps the Spotify playlist
and reports `partial`; a DB write failure after Spotify success reports
`created` with `persisted: false`. `/playlists` lists the persisted rows.

## Constraints and invariants

Load-bearing rules the code already satisfies. Each is enforced somewhere and
would break quietly if undone — they are not open work.

**The model id is re-validated server-side.** The client sends only an
`llm_models` row uuid; `lib/ai/models.ts` resolves it against `enabled = true`
rows and the `lib/ai/providers.ts` map before any billable call. Trusting a
client-supplied model string is unbounded cost exposure. `providers.ts` stays
server-only — importing it into a client component ships AI SDK code to the
browser bundle; the panel receives plain `{ id, label }` rows.

**`ensureVocabularyIds` is the only legal vocabulary write path.**
`.upsert(..., { onConflict: 'name' })` _without_ `ignoreDuplicates` compiles to
`ON CONFLICT DO UPDATE`, which fails under the RLS client — `genres`/`moods`
have INSERT but no UPDATE policy. `lib/vocabulary.ts` uses
insert-ignore-duplicates → select. Any write that bypasses it breaks `/api/tags`
at runtime with an RLS error.

**Confidence is rounded before it is thresholded.** `songs.ai_confidence` is
`numeric(3,2)`, so Postgres rounds to 2dp on write. Thresholding the raw value
(0.399 → unknown) and then storing it would persist 0.40, contradicting the
`< 0.4 → unknown` rule. The engine rounds + clamps, _then_ thresholds, then
writes the rounded value — which keeps the cutoff auditable in SQL and
`verify:enrichment` truthful.

**The closed vocabulary is prompt-enforced, not schema-enforced.** The zod
schema still types genres/moods as `z.array(z.string())`. A hard
`z.enum(approvedNames)` would make off-list output impossible — but also
invisible, so nothing would reach `unmatched_tags` and the signal for growing
the approved lists would disappear. It also needs a per-request dynamic schema
built with an `as` cast the TS rules discourage. Deliberate trade; flip only
with eyes open.

**The two `songs` writers are pinned by type, not by the table.**
`SongMetadata` (`lib/spotify/import.ts`) and `EnrichmentWrite`
(`lib/enrichment/engine.ts`) make it a compile error for either writer to touch
the other's columns. Postgres cannot express this — there are no column-level
grants and both writers use the service role — so a new call site doing
`admin.from('songs').upsert({...})` directly still type-checks. Route any third
writer through an alias rather than widening one.

**gpt-5 models reject non-default `temperature`,** and a small
`maxOutputTokens` starves reasoning tokens (they count against the cap),
truncating the JSON. The engine sets neither; `reasoningEffort` via
`providerOptions.openai` is the intended cost/quality knob.

**`maxDuration` is a ceiling, not a target.** `/api/enrich` exports
`maxDuration = 300` (Vercel Fluid ceiling on Hobby), but legacy non-Fluid
projects cap at 60s — so `ENRICHMENT_BATCH_SIZE` must keep one call under ~60s
or runs die mid-batch on those deploys.

**zod must stay a direct `^4` dependency.** It also exists transitively via
shadcn with a `^3` range; if the explicit `^4` pin in `package.json` is dropped,
an install could resolve v3 at the root and break schema typing subtly.

**Only the proxy may refresh the session token.** `getUser()` rotates the token
whenever it is within 90s of expiry (auth-js `EXPIRY_MARGIN_MS`), and
`lib/supabase/server.ts` swallows cookie writes in server components — so a
`getUser()` in a page or layout consumes a refresh token whose replacement is
then thrown away. The proxy resolves the caller once and publishes it on
`lib/auth/identity.ts` headers; pages and `AccountMenu` read those. The headers
are proxy-owned: every path through `proxy.ts`, the prefetch early-return
included, must strip the inbound copy or a forged `x-user-id` reaches the render.
`/api/*` is the deliberate exception — it re-verifies through `requireUser`,
and route handlers _can_ persist a rotated cookie.

**The proxy deliberately has no fetch retries.** `lib/supabase/fetch.ts` is
wired into `admin.ts` and `server.ts` but **not** `lib/supabase/session.ts`.
During an outage, navigations fail `getUser()` fast and fall back to the
`hasAuthCookie` pass-through instead of hanging every page load ~7s per attempt.
If a proxy-level hard auth gate is ever added, it needs the retryable-vs-real
distinction that `/api/*` gets from `requireUser`.

**`llm_models` row content is operational data.** The initial catalog was
seeded once (`supabase/migrations/20260722211849_add_llm_models.sql`); models,
the default flag, ordering and `enrichment_rank` are edited in Supabase Studio
thereafter. Do not add further seed migrations — they would fight Studio edits
and resurrect deleted models. An empty or fully-unmapped catalog is the designed
"enrichment unavailable" panel state, not an error.

## Where does new code go

- Page → `app/<route>/page.tsx`; signed-in-only pages also add their prefix
  to `PROTECTED_PREFIXES` in `proxy.ts`.
- Route handler → `app/api/<name>/route.ts`; must gate on `getUser()` (proxy
  protection doesn't cover `/api`).
- Component → `components/<kebab-case>.tsx` (`'use client'` as low as
  possible); shadcn primitives → `components/ui/` via the CLI.
- Server/shared logic → `lib/<domain>/`; pick the Supabase client per its
  header (`server.ts` RLS vs `admin.ts` service role). Default to `server.ts`:
  `admin.ts` bypasses RLS, so importing it is lint-restricted to an allowlist
  and every query it runs must carry its own `user_id` scope.
- New table / schema change → new file in `supabase/migrations/` +
  regenerated `lib/supabase/types.ts`, via the full sequence in
  `.claude/rules/database.md` (migration → push → gen:types → advisors →
  verify:rls → typecheck; commit migration + types together).
- Script → `scripts/*.mjs|mts` with a header comment + an npm script using
  `--env-file=.env.local`.
- Env var → `.env.local`, documented in `.env.example`; server-side only
  unless prefixed `NEXT_PUBLIC_`.
