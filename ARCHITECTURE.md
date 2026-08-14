# Architecture map

Agent-facing wayfinding index: where things live and which files implement
what. Kept deliberately compact — line-level detail lives in the linked files,
product/schema rationale in `MVP-PLAN.md`. Any change that adds, moves,
renames, or removes files, routes, tables, or env vars updates this file in
the same commit (rule in `AGENTS.md`).

## Directory map

- `app/` — App Router pages + route handlers; `app/globals.css` holds the
  theme tokens (light/dark CSS variables).
- `app/api/` — JSON route handlers for the client-driven batch loops and
  mutations (import, enrich, enrichment requests, tags) plus the two
  per-keystroke read endpoints (prompt ideas, library tag suggestions).
- `app/auth/` — OAuth callback + signout route handlers.
- `components/` — React components (kebab-case, one primary per file);
  `library-*.tsx` are the `/library` panels and table — only
  `import-panel`, `enrichment-panel`, `search-bar`, `tag-editor`,
  `recheck-action`, and `confidence-info` are client components; `chat-screen.tsx`
  (chat state owner), `chat-conversation.tsx` (messages + composer), and
  `playlist-preview-panel.tsx` (proposal review + create) are the `/chat` UI;
  `playlist-status-panel.tsx`, `playlist-actions.tsx`, and
  `playlist-tag-chips.tsx` provide the narrow client/server islands on the
  managed `/playlists` cards; `playlistify-mesh-landing.tsx` owns the shared
  Wake/Veil canvas and `playlistify-mesh-tagline.tsx` owns its animated landing
  copy. Shared chrome: `site-header.tsx`,
  `nav-links.tsx`, `account-menu{,-client}.tsx`, `theme-toggle.tsx`,
  `spotify-sign-in-button.tsx`, and `page-section.tsx` (the standard page
  container every route renders into).
- `components/ui/` — shadcn/ui primitives, built on `@base-ui/react` (not
  Radix), including the `dialog` and destructive-confirmation `alert-dialog`.
  Touch only to restyle a primitive; add new ones via the shadcn CLI.
- `public/` — static assets, including the Chandler hugging cutout shown on the
  `/` landing page.
- `lib/ai/` — `providers.ts` (server-only provider → AI SDK factory map;
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
  `prompt.ts` (`buildChatSystemPrompt`), `suggestions.ts` (server-only
  library-grounded prompt ideas), `use-prompt-suggestions.ts` (client-side
  session cache + loading state), and `contract.ts` (client-safe proposal +
  create-response parsers).
- `lib/library/` — `/library` search: `search-params.ts` (isomorphic URL state —
  parse/canonicalize/build plus the transition helpers; only `withLibraryPage`
  keeps the page), `search.ts` (server-only `searchLibrary` over
  `library_search_page` + the hydration pass), `song.ts` (`LibrarySong` /
  `LibraryTag` row shapes), `pagination.ts` (pure slot model), and
  `use-tag-suggestions.ts` (client-side debounced typeahead with a bounded
  module cache).
- `lib/landing/` — client-safe landing-page copy and the never-repeat random
  tagline picker.
- `lib/enrichment/` — `engine.ts` (enqueue/claim loop + structured-output
  call), `recipes.ts` (system recipe, queue, lease, counts, and recheck RPC
  contracts), `candidates.ts` (per-song normalization), `promotion.ts`
  (attempt + atomic promotion calls), `policy.ts` (pure promotion matrix),
  `requests.ts` (service-role recheck entry point), `confidence.ts` /
  `recheck.ts` (client-safe confidence-band and recheck copy), `schema.ts` (zod output
  schema, confidence threshold, `ai_attributes` parser), and `rank.ts`
  (legacy reset-script rank constants).
- `lib/spotify/` — `api.ts` (typed Web API client), `import.ts` (Liked Songs
  batch import), `token.ts` (Spotify access-token refresh).
- `lib/playlists/` — playlist creation and post-creation management:
  `tracks.ts` (ordered RLS-scoped Spotify-id resolution), `build.ts` (shared
  create/chunk-add/empty-shell cleanup), `create.ts`, `sync.ts`, `update.ts`,
  `delete.ts`, `recreate.ts`, `validation.ts`, and the client-safe response
  parsers in `contract.ts`.
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
- `lib/json.ts` / `lib/sleep.ts` / `lib/utils.ts` — shared JSON narrowing
  guards / abort-aware sleep / the shadcn `cn()` class merger (all importable
  from server and client code).
- `scripts/` — Node ops + verification scripts (`npm run verify:*`,
  `gen:types`, `reset:enrichment`); each file's header comment says what it
  proves. `verify-re-enrichment.mts` runs the promotion matrix as pure policy
  tests, then checks the remote queue/attempt/canonical and RLS invariants —
  it is the executable form of the guarded-re-enrichment test matrix.
  `verify-playlists.mts` live-checks Spotify playlist create, list, add,
  generated cover metadata, details-update, and unfollow endpoints;
  `verify-rls.mjs`, `verify-import.mjs`, `verify-enrichment.mjs`,
  `verify-genres.mts`, and `verify-chat-prompt.mts` cover their own domains,
  and `check-tokens.mjs` / `exercise-refresh.mts` probe the Spotify token
  path. `check-node-version.mjs` enforces Node 24 before dev and build; shared
  env guard lives in `scripts/lib/env.mjs`.
- `supabase/migrations/` — schema source of truth. Core tables are `profiles`,
  `spotify_tokens`, `songs`, `genres`, `moods`, AI and personal tag links,
  `user_songs`, `playlists`, `playlist_songs`, `llm_models`, and
  `unmatched_tags`. Guarded re-enrichment adds `enrichment_recipes`,
  `song_enrichment_jobs`, immutable `song_enrichment_attempts`,
  `enrichment_recheck_limits`, and private `user_{genre,mood}_suppressions`.
  Service-role RPCs own job enqueue/claim/release, attempt recording, atomic
  promotion, recheck requests, and outcome counts. Authenticated
  security-invoker RPCs expose effective tag names, selectable songs, matching
  song ids, row-level recheck states, the per-playlist effective-tag summary,
  and — added by `library_search`, which also installs `pg_trgm` into the
  `extensions` schema — `library_search_page()` (one filtered, counted,
  ordered page of the library) and `library_tag_suggestions()` (typeahead).
  Those two apply **no** `ai_confidence` gate, unlike
  `library_effective_tagged_songs()`: they filter what the Library displays,
  not what the assistant may build from. `songs.search_text` is a generated
  lowercased `title + artists` column behind a trigram GIN;
  `user_songs (user_id, liked_at desc nulls last, song_id)` makes the canonical
  library order an ordered index scan. `playlists.spotify_status`,
  `spotify_checked_at`, and `spotify_image_url` cache the latest
  user-triggered Spotify reachability and metadata scan. Column detail lives
  in `MVP-PLAN.md` § Database Schema.
- `proxy.ts` — runs on every request: session refresh + route protection.
- Root: `MVP-PLAN.md` (product spec), `HOW-IT-WORKS.md` (plain-language
  reasoning for behavior that has shipped), `IMPROVEMENTS.md` (committed log of
  sharp edges + deferred work), `AGENTS.md`/`CLAUDE.md` (agent instructions),
  `README.md` (setup), `.nvmrc` + `package.json#engines` (Node 24 runtime
  contract), `.env.example` (every env var, commented), `next.config.ts`
  (Spotify image host allowlist).

## Route inventory

Pages — protected prefixes are `PROTECTED_PREFIXES` in `proxy.ts`:

- `/` — Wake animated mesh, briefly rotating liked-songs tagline, and
  "Continue with Spotify"; proxy redirects signed-in users to `/chat`
  (`app/page.tsx`,
  `components/playlistify-mesh-landing.tsx`,
  `components/playlistify-mesh-tagline.tsx`,
  `components/spotify-sign-in-button.tsx`).
- `/v2` — alternate Veil presentation of the shared landing mesh and briefly
  rotating tagline for design comparison (`app/v2/page.tsx`,
  `components/playlistify-mesh-landing.tsx`,
  `components/playlistify-mesh-tagline.tsx`).
- `/library` — import panel, system-selected enrichment panel, and a
  database-side search: one combobox that commits free text, AND-combined
  genre/mood filter pills, or OR-combined Confidence band pills, over a
  first/last/numbered paginated table with a Confidence band, private AI-tag
  hiding, personal tags, and a per-song re-analysis control on every row below
  High showing the tries it has left. The row's title cell is its `<th
scope='row'>`, so that control is announced against a song name; one `sr-only`
  paragraph per table carries the shared-result and budget copy for all of them
  via `aria-describedby`, and the control uses `aria-disabled` rather than
  `disabled` so a mid-request click does not drop focus to `<body>`. URL state is
  `?q=&genre=&genre=&mood=&band=&page=` (repeated params, tag names and band
  slugs as the keys). Bands OR because a song carries exactly one; they still
  AND with text and tags. Only the results suspend, so the
  panels and the typed query survive every search
  (`app/library/page.tsx`, `app/library/loading.tsx` (instant skeleton
  streamed while the page's counts query runs) +
  `components/library-{import-panel,enrichment-panel,search-bar,results,table,table-skeleton,pagination,tag-editor,confidence-info,recheck-action}.tsx`
  → `lib/library/*`).
- `/chat` — describe a playlist; conversation streams beside a live preview
  panel (rename, edit, drop tracks, create). Server-rendered empty states for
  no-library / not-yet-enriched (`app/chat/page.tsx` + `components/chat-*`,
  `components/playlist-preview-panel.tsx`).
- `/playlists` — created-playlist management: cached live Spotify status and
  authoritative title/description/cover metadata, edit, delete/unfollow,
  recreate-from-stored-tracks, effective genre/mood rollups, and a Start
  Playlist link
  (`app/playlists/page.tsx`, `app/playlists/loading.tsx` +
  `components/playlist-{status-panel,actions,tag-chips}.tsx`).
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
- `POST /api/import` — one Liked Songs batch, body
  `{offset, syncStartedAt}`. The server issues `syncStartedAt` on the first
  batch (`offset: 0` must send `null`) and every later batch echoes it back, so
  one client loop is one sync pass (`app/api/import/route.ts` →
  `lib/spotify/import.ts`).
- `POST /api/enrich` — enqueue/claim and process one system-selected analysis
  batch, body `{processedSoFar}`, `maxDuration` 300
  (`app/api/enrich/route.ts` → `lib/enrichment/engine.ts`).
- `POST /api/enrichment-requests` — request/coalesce a stronger analysis for
  one owned Low or None song, body `{songId}`
  (`app/api/enrichment-requests/route.ts` → `lib/enrichment/requests.ts`).
- `POST|DELETE /api/tags` — explicit `add`, `remove`, `hide`, or `show`
  operation for one personal/effective tag
  (`app/api/tags/route.ts` → `lib/tags.ts`).
- `POST|PATCH|DELETE /api/playlists` — create from a curated proposal, update
  stored + Spotify details, or unfollow/delete; bodies
  `{name, description, songIds, prompt}`, `{playlistId, name, description}`,
  and `{playlistId}` (`app/api/playlists/route.ts` → `lib/playlists/{create,
update,delete}.ts`).
- `POST /api/playlists/sync` — scan `/me/playlists` and atomically cache
  reachability plus Spotify-authoritative title, description, and temporary
  cover URL for every stored playlist (`app/api/playlists/sync/route.ts` →
  `lib/playlists/sync.ts` → `sync_playlist_spotify_metadata()`).
- `POST /api/playlists/recreate` — rebuild a playlist from its stored ordered
  songs, body `{playlistId}` (`app/api/playlists/recreate/route.ts` →
  `lib/playlists/recreate.ts`).
- `POST /api/chat` — streaming chat, body `{messages}` (UIMessage[]),
  `maxDuration` 300 (`app/api/chat/route.ts` → `lib/chat/*`).
- `GET /api/prompt-suggestions` — three library-grounded empty-chat ideas from
  the configured chat model
  (`app/api/prompt-suggestions/route.ts` → `lib/chat/suggestions.ts`).
- `GET /api/library/tag-suggestions?q=` — matching genre/mood names present in
  the caller's library with capped head counts, for the filter bar and the
  per-song tag editor. Enforces the three-character minimum and the row/count
  caps server-side (`app/api/library/tag-suggestions/route.ts` →
  `library_tag_suggestions()`).

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
them) + `user_songs`. Each seen join row receives that pass's `syncStartedAt`
in `imported_at` — issued server-side on the first batch, echoed by the client
afterwards and re-validated. Only after the complete import, older rows become
removal candidates; `/me/library/contains` confirms each candidate is no
longer saved before its private `user_songs` row is deleted. Partial imports
never prune, and the confirmation keeps offset drift or overlapping tabs from
deleting a current song. The `SongMetadata` alias pins that payload to the nine
Spotify columns, and `EnrichmentWrite` (`lib/enrichment/engine.ts`) pins the
other side — the two writers cannot reach each other's columns without a
compile error. Artist-genre lookup degrades to `[]` on failure — the
batch `/artists` endpoint 403s for this app (divergence: MVP-PLAN assumes it
works).

**Enrichment** — `components/library-enrichment-panel.tsx` loops
`POST /api/enrich` with only `processedSoFar`; the browser supplies no model,
recipe, or rank authority. `lib/enrichment/engine.ts` asks Postgres to create
or coalesce eligible jobs, then lease one same-recipe batch for songs in the
caller's library (env caps `ENRICHMENT_BATCH_SIZE` /
`ENRICHMENT_MAX_SONGS_PER_RUN`). The server generates the lease token before
the claim RPC; replaying a lost HTTP response with that same token returns the
already-leased batch instead of reserving another. The server-selected recipe
resolves through `lib/ai/providers.ts`, and one AI SDK v7 `generateText` +
`Output.object` call produces candidates.

Every claimed song produces an immutable attempt: recognized, unknown,
omitted, or failed. `promote_song_enrichment_attempt` locks the attempt, job,
and canonical song, re-evaluates the promotion matrix, and either atomically
replaces the full canonical attributes/tag snapshot or rejects the candidate
without touching it. Pending and None keep their carve-outs (nothing to lose,
no tags to lose); everything else is one ordinal comparison over
`confidence_band_rank()`, so a candidate must land in a strictly better band —
Low accepts Medium/High, Medium accepts only High, High never enters
re-analysis, and a same-band re-roll is `not_better`. That High branch is the
last of three gates (`next_enrichment_recipe`, the recheck RPC, then here) and
the only one under a row lock, so it is what holds when a song turns High
mid-lease. Highest-attempted recipe rank advances even on rejection, which
prevents duplicate billing. Jobs are unique per song/recipe, claims use
expiring leases, stale lease tokens cannot commit, and omissions and provider
failures back off before being retired after three tries for that recipe.

**Eligibility is one function.** `next_enrichment_recipe(song, status,
confidence, highest_rank)` returns the recipe that should run next or null, and
the bulk selector, the recheck RPC, the panel counts, and the per-row state all
call it. A song may be analyzed **three times per recipe rank** — the budget is
derived by `enrichment_attempts_remaining_at_rank()` from the append-only
attempts log, not stored, so it cannot drift; a locked song re-opens for free
when a higher-ranked recipe is enabled, because a different rank is a different
count. Only `recognized`/`unknown` attempts spend the budget; omissions and
provider failures use `song_enrichment_jobs.attempt_count` instead, so a song
that was skipped twice still gets three real analyses. Ranks below the highest
already attempted are excluded (promotion would reject them as `superseded`),
recipes carrying a `failed` job are excluded (they would re-open forever), and
escalation sorts before a same-rank retry so enabling a stronger recipe moves
songs up rather than burning their budget where they are.

A same-rank retry **re-opens the existing completed job** rather than creating
one: `song_enrichment_attempts` is unique on `(job_id, lease_token)`, so many
attempts per job row were always supported. The re-open bumps `request_count`
(previously written once and never incremented) and leaves `attempt_count`
alone — that counter is the omission/failure allowance, and touching it either
makes the next transient failure terminal or hands out a fresh omission budget.

Queue order is `priority desc`, then reach (how many libraries hold the song),
then `liked_at desc`. `priority` is set at enqueue from the band: never-analyzed
500/600, None 200 background and 400 explicit, Low/Medium 100 background and 300
explicit — so a user's first pass always outranks improvement work, and an
explicit request jumps the background queue without bypassing eligibility,
attempt budgets, cooldowns, or promotion rules. There is no single-song LLM
path: a request rides at the head of the next claimed batch.
Reach is a prioritization signal only; it never affects promotion.
`library_recheck_states()` reports the per-row state machine
(`available` / `queued` / `analyzing` / `throttled` / `no_better_recipe` /
`checked_not_improved` / `improved`, labelled in `lib/enrichment/recheck.ts`)
alongside `attempts_remaining`. The 10-second cooldown answers `throttled`,
which used to be one of three unrelated branches returning `already_checked` —
so a double-click read as a genuine no-improvement result. The last decision
now sorts **before** availability, because a song that came back "no change"
usually does have another try left and both facts matter; `attempts_remaining`
reports 0 whenever no recipe would run, so `> 0` means exactly "clicking will
analyze something" and is the only thing the row control keys off.

The vocabulary remains **closed**: the prompt carries only `is_approved`
`genres`/`moods`; `matchApprovedVocabulary` snaps or drops output, and
`unmatched_tags` records dropped names. Confidence is rounded before the 0.4
recognition cutoff. Library outcome counts and recheck states come from
database RPCs so the panel, rows, and queue share one eligibility definition.

**Personal tags and suppressions** —
`components/library-tag-editor.tsx` → `/api/tags` → `lib/tags.ts` on the RLS
client. Every operation proves `user_songs` ownership. Personal additions use
the open `ensureVocabularyIds` path and private `user_genres`/`user_moods`;
`hide`/`show` only add or remove private suppression rows for tags that are
actually on the canonical song. Effective tags are canonical Medium/High AI tags
minus that user's suppressions, union personal tags; a same-name personal tag
wins. A personal tag can make an unrecognized song selectable, but absent AI
attributes still cannot satisfy energy/era filters. The editor's two comboboxes
suggest from `GET /api/library/tag-suggestions` (three-character minimum,
debounced) rather than preloading the whole shared vocabulary; free entry still
accepts any name, and `ensureVocabularyIds` snaps it onto the existing row.

**Library search** — `app/library/page.tsx` parses the URL through
`lib/library/search-params.ts` and renders `LibrarySearchBar` plus a
`<Suspense>` keyed on the canonical href, so a search remounts a fresh boundary
(a revealed one would not fall back) while the panels and the typed query stay
put. Inside it, `LibraryResults` → `searchLibrary` → `library_search_page()`
does all filtering, counting, ordering, and paging in Postgres and returns thin
ids; the app then hydrates song detail and the six tag embeds with one
`.in('song_id', ids)` and scopes `library_recheck_states()` to the same ids.
Free text ANDs its whitespace-separated terms (each matching title or artist,
longest first so the seed drives the trigram index); pills AND across genres
and moods by relational division. Filter matching is source-agnostic and
ungated: an AI link the user has not hidden, or the user's own link, on any
confidence band — clicking a chip you can see always finds the row it was on.
Confidence band pills go through `confidence_band()`, the one SQL definition of
the band rule; `get_library_enrichment_counts` and the row badge must agree with
it, and an expression index over the identical call keeps the predicate
sargable without a generated column. Bands are a closed set of five, so the bar
matches them locally with no request and no three-character minimum.

**Chat / selection** — `components/chat-screen.tsx` (`useChat` +
`DefaultChatTransport`) streams to `POST /api/chat`. The route fetches one
`getLibraryTagSummary` and uses it twice: to build the library-grounded system
prompt (`lib/chat/prompt.ts`) and to bound what `search_library` may resolve,
so the assistant searches exactly the vocabulary it was shown. The tag lists
in the prompt are **complete, never sampled** — a truncated list is a silently
unsearchable slice of the library. The empty conversation separately requests
three ideas grounded in a random bounded sample of those real tags and caches
them in `sessionStorage`, so they stay stable across reloads in one browser tab.
Then `streamText` with a `stepCountIs(8)` tool loop. `search_library`
(`lib/chat/tools.ts`) resolves requested tags
against that vocabulary (`resolveTags`, fuzzy-snapping via
`snapToExistingName`), resolves effective matching ids through
`library_effective_tagged_songs`, intersects across kinds and with the
selectable index (recency), scans ≤1000, TS-post-filters by
energy/era/exclude, and returns ≤80 candidates. Low AI tags stay visible
in Library but do not drive chat matching; personal tags remain effective at
every analysis state.
`propose_playlist` verifies ownership and returns the preview payload. The
proposal renders ONLY in `components/playlist-preview-panel.tsx`, never as
chat text (prompt- and renderer-enforced).

**Playlist creation** — the preview panel POSTs a curated proposal to
`/api/playlists` → `lib/playlists/create.ts` (`createPlaylistForUser`, RLS
client): `tracks.ts` resolves song ids → Spotify track ids scoped by RLS,
refreshes the token (`lib/spotify/token.ts`), then `build.ts` creates a private
playlist via `POST /me/playlists` and adds tracks in chunks before `create.ts`
persists `playlists` + `playlist_songs`.
Failure policy: pre-Spotify failures create nothing (clean
error/reconnect/rate-limited); an add-tracks failure keeps the Spotify playlist
and reports `partial`; a DB write failure after Spotify success reports
`created` with `persisted: false`. `/playlists` lists the persisted rows.

**Playlist management** — the JSON handlers keep the browser thin and call
RLS-scoped engines. Sync obtains one bounded `/me/playlists` metadata map;
`sync_playlist_spotify_metadata()` applies title, description, temporary cover
URL, `present`/`missing` status, and check time in one security-invoker write.
Spotify is authoritative while a playlist is reachable, so edit updates
Spotify before committing the same details locally; known-missing playlists
remain local-only. Delete tries Spotify unfollow when reachable but always
removes the local row even if Spotify fails. Recreate reads stored
`playlist_songs` order, skips songs no longer in the user's library, rebuilds
through `build.ts`, and replaces the stored Spotify id/status.
`playlist_tag_summary()` returns every playlist's effective AI and personal
genres/moods in one RLS-scoped call. The server page fetches the cards and
rollup in parallel; the status panel syncs on mount/manual refresh, while each
action cluster owns only its dialogs and mutations before refreshing the
server-rendered card.

## Constraints and invariants

Load-bearing rules the code already satisfies. Each is enforced somewhere and
would break quietly if undone — they are not open work.

**The browser has no enrichment model authority.** `/api/enrich` accepts only
progress bookkeeping and `/api/enrichment-requests` accepts only an owned song
id. Database functions choose an enabled default/next recipe; the engine then
resolves its provider/model snapshot through the server-only
`lib/ai/providers.ts`. Accepting a client model, recipe, or rank would expose
unbounded cost and shared-data authority.

**`ensureVocabularyIds` is the only legal vocabulary write path.**
`.upsert(..., { onConflict: 'name' })` _without_ `ignoreDuplicates` compiles to
`ON CONFLICT DO UPDATE`, which fails under the RLS client — `genres`/`moods`
have INSERT but no UPDATE policy. `lib/vocabulary.ts` uses
insert-ignore-duplicates → select. Any write that bypasses it breaks `/api/tags`
at runtime with an RLS error.

**Display and selection use two different effective-tag rules, on purpose.**
`library_search_page` / `library_tag_suggestions` apply
`(all AI links − this caller's suppressions) ∪ this caller's own links` with
**no** `ai_confidence` gate. `library_effective_tagged_songs` gates **only the
AI branch** on `enrichment_status = 'enriched' and ai_confidence > 0.5`; the
caller's own `user_genres`/`user_moods` links are unioned in ungated, and
`library_selectable_songs` / `library_tag_names` OR them in the same way — so a
personal tag counts for playlist building on any song in the caller's library,
whatever its band. Display must be ungated so a chip visible on a row finds
that row when clicked; the AI branch of selection must be gated so a Low
result never quietly shapes a playlist.
"Unifying the duplicated effective-tag logic" silently breaks one of the two.
Stated in the `library_search` migration header and in `HOW-IT-WORKS.md`;
no verification script asserts it yet (tracked in `IMPROVEMENTS.md`).

**One Confidence band rule, read by five surfaces.** The row badge
(`getConfidenceBand`), the panel totals (`get_library_enrichment_counts`), the
Library band filter, the promotion matrix, and `library_recheck_states()` must
classify every song identically, or a user filters by Low and gets rows the
badge calls Medium — or is offered a re-analysis the promotion rule will always
refuse. `public.confidence_band()` is the single SQL definition and all four SQL
readers call it; `getConfidenceBand` mirrors it in TypeScript, and
`confidence_band_rank()` orders the same five bands for the promotion
comparison, mirroring `CONFIDENCE_BAND_ORDER`. The two stay equivalent only because `enrichment_status` is CHECKed
to `('pending', 'enriched', 'unknown')`, which is what makes SQL's
`<> 'enriched'` and the counts' `= 'unknown'` the same test — widen that CHECK
and the None band silently swallows the new status. Bands OR rather than AND in
the URL because a song carries exactly one.

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

**Canonical enrichment writes only happen in atomic promotion.**
`SongMetadata` (`lib/spotify/import.ts`) pins import upserts to Spotify columns.
The engine never writes canonical enrichment tables directly: it records an
attempt and invokes `promote_song_enrichment_attempt`, which updates the song,
AI genres, AI moods, job, and decision in one transaction. A new service-role
write to those canonical columns or link tables would bypass downgrade and
lease protection.

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

**Model and recipe rows are operational data.** The initial model catalog and
legacy recipe snapshots were seeded once. Models and versioned recipes are
owner-curated in Supabase Studio thereafter; prompt, vocabulary, or identity
changes create a new recipe instead of mutating old attempt identity. Exactly
one enabled recipe is the default for pending work. Do not add recurring seed
migrations that fight Studio edits or resurrect deleted rows.

A vocabulary revision is the one case that reaches the recipe table from a
migration, because the approved `genres`/`moods` rows it depends on are
themselves migrated. `20260814003544_widen_mood_vocabulary.sql` is the shape to
copy: approve the new names, disable the outgoing generation, then insert a
replacement recipe per model carrying the same rank, prompt and identity at the
new `vocabulary_version`. Ranks are preserved so no song's eligibility moves,
and `song_enrichment_attempts` keeps pointing at the recipe it actually ran
under. Every version the app can still run is listed in `isSupportedRecipe`
([lib/enrichment/recipes.ts](lib/enrichment/recipes.ts)) — a claimed job naming
an unlisted version is released rather than guessed at, so that list and the
catalog must be updated together.

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
