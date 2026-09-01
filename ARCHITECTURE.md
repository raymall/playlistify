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
  mutations (import, enrich, tags) plus the two read endpoints
  (once-per-session prompt ideas, per-keystroke library tag suggestions).
- `app/auth/` — OAuth callback + signout route handlers.
- `components/` — React components (kebab-case, one primary per file);
  `library-*.tsx` are the `/library` panels and table — only
  `import-panel`, `enrichment-panel`, `search-bar`, `table`, `tag-editor`,
  and `confidence-info` are client components; `chat-screen.tsx`
  (chat state owner), `chat-conversation.tsx` (messages + composer), and
  `playlist-preview-panel.tsx` (proposal review + create) are the `/chat` UI;
  `playlist-status-panel.tsx`, `playlist-actions.tsx`, `playlist-details.tsx`, and
  `playlist-tag-chips.tsx` provide the narrow client/server islands on the
  managed `/playlists` cards; `playlistify-mesh-landing.tsx` owns the shared
  Wake/Veil canvas and `playlistify-mesh-tagline.tsx` owns its animated landing
  copy. Shared chrome: `site-header.tsx`,
  `nav-links.tsx`, `account-menu{,-client}.tsx`, `theme-toggle.tsx`,
  `spotify-sign-in-button.tsx`, and `page-section.tsx` (the standard page
  container the signed-in routes render into; the `/` and `/v2` landing
  pages render the mesh directly).
- `components/ui/` — shadcn/ui primitives, built on `@base-ui/react` (not
  Radix), including the `dialog` and destructive-confirmation `alert-dialog`.
  Touch only to restyle a primitive; add new ones via the shadcn CLI.
- `public/` — static assets, including the Chandler hugging cutout shown on the
  `/` landing page.
- `recipes/` — the authored enrichment-recipe catalog: `definitions.ts` (typed
  list of every recipe — key, model, effort, batch size, rank, prompt file,
  identity fields, output spec, enabled/default flags) and `prompts/*.md` (the
  prompt prose, one file per revision, for clean diffs). `npm run recipe:sync`
  turns this into `enrichment_recipes` rows; nothing at runtime reads it.
- `lib/ai/` — `providers.ts` (server-only provider → AI SDK factory map;
  `resolveProviderModel` and `resolveProviderEffortOptions` — how each
  provider spells a reasoning effort — both non-throwing: callers map the
  error variant to their own failure path), `chat-model.ts` (resolves the
  chat model from the `CHAT_MODEL` env var, not the catalog).
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
- `lib/landing/` — client-safe landing-page copy and the complete shuffled
  tagline-loop builder.
- `lib/enrichment/` — `engine.ts` (enqueue/claim loop + structured-output
  call; everything the call is shaped by comes off the claim's frozen recipe
  snapshot), `recipes.ts` (recipe, queue, lease, and counts RPC contracts,
  `isSupportedRecipe` — the capability check over a claimed snapshot — plus
  the `EnrichmentRecipeSummary` the Library reports), `identity.ts` (the
  per-field formatters `identity_fields` name; the song line is built from
  them), `candidates.ts` (per-song normalization), `promotion.ts` (attempt +
  atomic promotion calls), `policy.ts` (pure promotion matrix, mirrored from
  SQL for `verify:re-enrichment`), `confidence.ts` (client-safe confidence
  bands, the per-rank answer budget, and the shared-result/budget copy), and
  `schema.ts` (the bounded `output_spec` parser + per-recipe zod schema
  builder, confidence threshold, `ai_attributes` parser).
- `lib/spotify/` — `api.ts` (typed Web API client), `import.ts` (Liked Songs
  batch import), `token.ts` (Spotify access-token refresh).
- `lib/playlists/` — playlist creation and post-creation management:
  `tracks.ts` (ordered RLS-scoped Spotify-id resolution), `build.ts` (shared
  create/chunk-add/empty-shell cleanup), `create.ts`, `sync.ts`, `update.ts`,
  `delete.ts`, `recreate.ts`, `validation.ts` (shared UUID/playlist-id
  narrowing + name/description limits), `spotify-failures.ts` (shared mapping
  from Spotify token/API failures onto the engines' common failure arms), and
  the client-safe response parsers in `contract.ts`.
- `lib/supabase/` — client factories + plumbing: `client.ts` (browser anon),
  `server.ts` (request-scoped RLS), `admin.ts` (service role — importing it is
  lint-restricted to an allowlist in `eslint.config.mjs`), `session.ts`
  (proxy session refresh + identity headers), `auth.ts` (`isSessionDead` /
  `classifyNullUser`: tells a real logout apart from a token-rotation or
  network blip, and logs which), `fetch.ts` (network-retry fetch), `env.ts`
  (public connection env guard), `types.ts` (generated — regenerate with
  `npm run gen:types`, never edit).
- `lib/tags.ts` / `lib/vocabulary.ts` — personal-tag mutations / shared
  genre-mood vocabulary (normalize, validate, name→id). **All matching is
  exact on the normalized name; there is no fuzzy or near-duplicate snapping
  anywhere.** Three match paths: `matchApprovedVocabulary` (closed,
  `is_approved` rows only — enrichment; off-list names drop and are logged),
  `ensureVocabularyIds` (open, inserts whatever the user typed — personal
  tags), and chat's `resolveTags` (`lib/chat/tools.ts`), which looks up the
  library's own tags — approved or not — so the assistant can search every
  name the prompt showed it.
- `lib/json.ts` / `lib/sleep.ts` / `lib/utils.ts` — shared JSON narrowing
  guards / abort-aware sleep / the shadcn `cn()` class merger (all importable
  from server and client code).
- `scripts/` — Node ops + verification scripts (`npm run verify:*`,
  `gen:types`, `recipe:sync`); each file's header comment says what it proves.
  `sync-recipes.mts` (`npm run recipe:sync`) hashes `recipes/definitions.ts`
  with a live approved-vocabulary snapshot and mints/activates
  `enrichment_recipes` rows — dry-run by default, `-- --yes` to write; a fresh
  database has no recipes until it runs, so it is part of environment setup.
  `verify-recipes.mts` proves the catalog matches the definitions, recomputes
  every stored content hash, and reports approved-vocabulary drift since the
  newest snapshot. `verify-re-enrichment.mts` runs the promotion matrix as pure policy
  tests, then checks the remote queue/attempt/canonical and RLS invariants —
  it is the executable form of the guarded-re-enrichment test matrix.
  `verify-playlists.mts` live-checks Spotify playlist create, list, add,
  generated cover metadata, details-update, and unfollow endpoints;
  `verify-rls.mjs`, `verify-import.mjs`, `verify-enrichment.mjs`,
  `verify-genres.mts`, and `verify-chat-prompt.mts` cover their own domains,
  and `exercise-refresh.mts` probes the Spotify token
  path. `check-node-version.mjs` enforces Node 24 before dev and build; the
  shared env guard lives in `scripts/lib/env.mjs`, the shared PASS/FAIL
  checker + head-count helper in `scripts/lib/verify.mjs`, and the canonical
  JSON + content-hash helpers both recipe scripts share in
  `scripts/lib/recipe-hash.ts` (the database stores these hashes, it never
  recomputes them).
- `supabase/migrations/` — schema source of truth. Core tables are `profiles`,
  `spotify_tokens`, `songs`, `genres`, `moods`, AI and personal tag links,
  `user_songs`, `playlists`, `playlist_songs`, `llm_models`, and
  `unmatched_tags`. Guarded re-enrichment adds `enrichment_recipes`,
  `song_enrichment_jobs`, immutable `song_enrichment_attempts`, and private
  `user_{genre,mood}_suppressions`; recipe snapshots add service-role-only
  `vocabulary_snapshots` (frozen approved lists, shared by content hash) and
  the snapshot columns + immutability trigger on `enrichment_recipes`.
  Service-role RPCs own job enqueue/claim/release, attempt recording, atomic
  promotion, and outcome counts. Authenticated
  RPCs expose effective tag names, selectable songs, matching
  song ids, the current recipe and where the next run would escalate
  (`library_enrichment_recipes()`), the recipe behind each song's result
  (`library_song_recipes()`), the per-playlist effective-tag summary,
  and — added by `library_search`, which also installs `pg_trgm` into the
  `extensions` schema — `library_search_page()` (one filtered, counted,
  ordered page of the library) and `library_tag_suggestions()` (typeahead,
  whose 50-row candidate pool is gated to the approved list plus the caller's
  own linked rows — see the sharp edge below).
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
  reasoning for behavior that has shipped), `DESIGN-SYSTEM.md` (visual-system
  tokens, components, and screen decisions), `IMPROVEMENTS.md` (committed log of
  sharp edges + deferred work), `AGENTS.md`/`CLAUDE.md` (agent instructions),
  `README.md` (public intro + setup), `.nvmrc` +
  `package.json#engines` (Node 24 runtime
  contract), `.env.example` (every env var, commented), `next.config.ts`
  (Spotify image host allowlist).

## Route inventory

Pages — protected prefixes are `PROTECTED_PREFIXES` in `proxy.ts`:

- `/` — Wake animated mesh, character-fading liked-songs tagline, and
  "Continue with Spotify"; proxy redirects signed-in users to `/library`
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
  hiding, and personal tags. The row's title cell is its `<th scope='row'>`, so
  the tag editor is announced against a song name. There is **no** per-song
  analysis control: the panel names the current recipe (model, effort, batch
  size, rank, snapshot hash) beside **Enrich**, plus a line per stronger
  recipe the next run would escalate to and how many songs move, and each row's
  tag popover names the recipe behind that song's own result — `Recipe:
current` when it is the default, otherwise the recipe's label. URL
  state is
  `?q=&genre=&genre=&mood=&band=&page=` (repeated params, tag names and band
  slugs as the keys). Bands OR because a song carries exactly one; they still
  AND with text and tags. Only the results suspend, so the
  panels and the typed query survive every search
  (`app/library/page.tsx`, `app/library/loading.tsx` (instant skeleton
  streamed while the page's counts and recipe queries run) +
  `components/library-{import-panel,enrichment-panel,search-bar,results,table,table-skeleton,pagination,tag-editor,confidence-info}.tsx`
  → `lib/library/*`).
- `/chat` — describe a playlist; conversation streams beside a live preview
  panel (rename, edit, drop tracks, create). Server-rendered empty states for
  no-library / not-yet-enriched (`app/chat/page.tsx` + `components/chat-*`,
  `components/playlist-preview-panel.tsx`).
- `/playlists` — featured-newest plus collection-grid playlist management:
  cached live Spotify status and authoritative title/description/cover
  metadata, Spotify-linked artwork and titles, a details dialog, edit,
  delete/unfollow, recreate-from-stored-tracks, effective genre/mood rollups,
  and a Start Playlist link
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
- `POST /api/enrich` — claim and process one batch of system-selected analysis,
  body `{processedSoFar}` and nothing else. `maxDuration` 300
  (`app/api/enrich/route.ts` → `lib/enrichment/engine.ts`).
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

Mechanism and file pointers only — the product reasoning behind these
behaviours lives in `HOW-IT-WORKS.md`.

**Auth + token refresh** — `components/spotify-sign-in-button.tsx` →
`lib/auth/spotify.ts` (browser OAuth start) → `app/auth/callback/route.ts`
(session exchange; upserts `profiles` and captures provider tokens into
`spotify_tokens` — the only place they are captured). Every request
thereafter: `proxy.ts` → `lib/supabase/session.ts` refreshes the session
cookie and forwards the resolved caller on `x-auth-state` (+ `x-user-id` /
`x-user-name` when signed in), so no page or layout re-derives it. Spotify
access tokens refresh on demand in `lib/spotify/token.ts`
(`getValidSpotifyToken`): service-role read, refresh near expiry;
`invalid_grant` deletes the row so callers surface the "reconnect Spotify"
state.

**Import** — `components/library-import-panel.tsx` loops `POST /api/import`
until done, riding out `safeToRetry` failures (`MAX_SAFE_RETRIES`).
`lib/spotify/import.ts` fetches up to 2 pages of `/me/tracks` through
`lib/spotify/api.ts` and upserts `songs` + `user_songs`, stamping each seen
join row with the pass's `syncStartedAt` (issued server-side on the first
batch, echoed by the client afterwards, re-validated). Only a completed pass
prunes, and every removal candidate is re-confirmed via
`/me/library/contains` first — that guards offset drift and overlapping tabs.
The `SongMetadata` alias pins the upsert to the nine Spotify columns;
canonical enrichment columns are written only inside
`promote_song_enrichment_attempt`, so the two writers cannot collide.
Artist-genre lookup degrades to `[]` on failure — the batch `/artists`
endpoint 403s for this app (divergence: MVP-PLAN assumed it works).

**Enrichment** — `components/library-enrichment-panel.tsx` loops
`POST /api/enrich` with only `processedSoFar`. `lib/enrichment/engine.ts`
asks Postgres to enqueue/coalesce eligible jobs, then lease one same-recipe
batch from the caller's library. The engine passes what remains of
`ENRICHMENT_MAX_SONGS_PER_RUN`; the claim narrows it to the recipe's own
`batch_size` — batch size and reasoning effort are recipe identity, not
deployment config. The lease token is generated before the claim RPC, so
replaying a lost HTTP response returns the already-leased batch. The claim
returns the recipe's complete frozen snapshot (system prompt, identity
fields, bounded output spec, approved vocabulary as minted); the model and
effort resolve through `lib/ai/providers.ts` into one AI SDK `generateText` +
`Output.object` call. A snapshot this build cannot execute faithfully is
released unclaimed for a safe retry (`isSupportedRecipe` + the two provider
resolvers).

Every claimed song produces an immutable attempt (recognized, unknown,
omitted, or failed). `promote_song_enrichment_attempt` locks the attempt,
job, and song, re-evaluates the promotion matrix, and atomically replaces the
full canonical attributes/tag snapshot or rejects without touching it. The
matrix (product rule in `HOW-IT-WORKS.md`, pure mirror in
`lib/enrichment/policy.ts`) is one ordinal comparison over
`confidence_band_rank()` — the candidate must land in a strictly better
band — with carve-outs for Pending/None and a High branch that additionally
requires the candidate's recipe to set `enrich_all_songs`, outrank
`songs.enrichment_rank`, and itself land High. Highest-attempted recipe rank
advances even on rejection, which prevents duplicate billing. Jobs are unique
per song/recipe, claims use expiring leases, stale lease tokens cannot
commit, and omissions/provider failures back off on
`song_enrichment_jobs.attempt_count` before retiring after three tries per
recipe — a counter separate from the answer budget below.

**Eligibility is one function.** `next_enrichment_recipe(song, status,
confidence, active_rank, highest_rank)` returns the recipe to run next or
null; the bulk selector, the panel counts, and the recipe report all call it.
The three-answers-per-rank budget is derived by
`enrichment_attempts_remaining_at_rank()` from the append-only attempts log —
never stored — and only `recognized`/`unknown` attempts spend it. Ranks below
the highest attempted are excluded (promotion would reject them as
`superseded`), recipes carrying a `failed` job are excluded, and escalation
sorts before a same-rank retry. The High gate compares
`songs.enrichment_rank` (moves only on promotion, so it holds still across
all three tries), not `highest_attempted_recipe_rank` (bumps on the first
attempt at a new rank — a gate on it would open for one try, not three); it
is also the rank promotion compares, which keeps the selector from offering
work promotion would refuse. A same-rank retry re-opens the existing
completed job (`song_enrichment_attempts` is unique on
`(job_id, lease_token)`) and leaves `attempt_count` alone — that counter is
the omission/failure allowance. Queue order is `priority desc` (set at
enqueue from the band: never-analyzed 500, None 200, else 100), then reach
(how many libraries hold the song), then `liked_at desc`; reach never
affects promotion.

**The recipe is reported, not requested.** There is no per-song analysis
path. Two security-definer RPCs, both scoped to
`us.user_id = (select auth.uid())` and granted only to `authenticated`
(`enrichment_recipes` and `song_enrichment_attempts` have RLS on with zero
policies), make the recipe visible: `library_enrichment_recipes()` (the
enabled default's full identity, plus a row per stronger enabled recipe and
how many songs would move) and `library_song_recipes()` (the recipe behind
each song's result — sourced from `active_enrichment_attempt_id` with a
fallback to `highest_attempted_recipe_id` for results predating atomic
promotion; the page scopes the call to its own `.in('song_id', ids)` set).
The escalation count sits behind an uncorrelated
`exists (select 1 from stronger)`, so with no stronger recipe enabled the
report costs three index lookups, not a library scan.

The vocabulary is **closed** (why: `HOW-IT-WORKS.md` § From a sentence to a
playlist): the prompt carries only the recipe's frozen
`vocabulary_snapshots` lists; `matchApprovedVocabulary` then validates the
response against the _live_ approved list (correct for `unmatched_tags`
review), keeps exact matches, and logs dropped names to `unmatched_tags`.
The gate is enforced twice — there, and in SQL, where promotion resolves
names through an `is_approved` join. Confidence is rounded before the 0.4
recognition cutoff. Outcome counts and the recipe report come from database
RPCs, so the panel, rows, and queue share one eligibility definition.

**Personal tags and suppressions** — `components/library-tag-editor.tsx` →
`/api/tags` → `lib/tags.ts` on the RLS client. Add, hide, and show prove
`user_songs` ownership; remove deletes only link rows already scoped to the
caller's `user_id`. Additions use the open `ensureVocabularyIds` path into
private `user_genres`/`user_moods`; `hide` records a suppression only for a
tag actually on the canonical song, and `show` removes the caller's
suppression row. Effective tags: canonical Medium/High AI tags − that user's
suppressions ∪ personal tags; a same-name personal tag wins. The editor's
comboboxes suggest from `GET /api/library/tag-suggestions` (three-character
minimum, debounced), but free entry accepts any name — **personal tags are
free-form**, stored as typed, matched only on the exact normalized name,
never snapped (product rule in `HOW-IT-WORKS.md` § Personal tags).

**Library search** — `app/library/page.tsx` parses the URL through
`lib/library/search-params.ts` and renders `LibrarySearchBar` plus a
`<Suspense>` keyed on the canonical href, so a search remounts a fresh
boundary while the panels and the typed query stay put. `LibraryResults` →
`searchLibrary` → `library_search_page()` filters, counts, orders, and pages
in Postgres and returns thin ids; the app hydrates song detail and the six
tag embeds with one `.in('song_id', ids)` and scopes
`library_song_recipes()` to the same ids. Free text ANDs its
whitespace-separated terms (longest first so the seed drives the trigram
index); genre/mood pills AND by relational division; Confidence-band pills OR
through `confidence_band()`, the single SQL band definition, kept sargable by
an expression index. Filter matching is source-agnostic and ungated — see
the display-vs-selection invariant below. Bands are a closed set of five,
matched locally with no request.

**Chat / selection** — `components/chat-screen.tsx` (`useChat` +
`DefaultChatTransport`) streams to `POST /api/chat`. The route fetches one
`getLibraryTagSummary` and uses it twice: to build the system prompt
(`lib/chat/prompt.ts`) and to bound what `search_library` may resolve, so the
assistant searches exactly the vocabulary it was shown. The prompt's tag
lists are complete up to a 600-name-per-kind cap (`TAG_LIST_MAX`), never
sampled — a truncated list is a silently unsearchable slice of the library,
and `verify:chat-prompt` asserts the cap is unhit. The empty conversation
separately requests three ideas grounded in a bounded sample of real tags,
cached in `sessionStorage`. Then `streamText` with a `stepCountIs(8)` tool
loop: `search_library` (`lib/chat/tools.ts`) resolves tags by exact
normalized match (`resolveTags` — a miss means the model invented a name,
and `unmatchedTags` says so), resolves matching ids through
`library_effective_tagged_songs`, intersects across kinds and with the
selectable index (recency), scans ≤1000, TS-post-filters by
energy/era/exclude, and returns ≤80 candidates. `propose_playlist` verifies
ownership and returns the preview payload, rendered ONLY in
`components/playlist-preview-panel.tsx`, never as chat text (prompt- and
renderer-enforced).

**Playlist creation** — the preview panel POSTs a curated proposal to
`/api/playlists` → `lib/playlists/create.ts` (`createPlaylistForUser`, RLS
client): `tracks.ts` resolves song ids → Spotify track ids scoped by RLS,
`lib/spotify/token.ts` refreshes the token, `build.ts` creates a private
playlist and adds tracks in chunks, then `create.ts` persists `playlists` +
`playlist_songs`. Failure policy: pre-Spotify failures create nothing (clean
error/reconnect/rate-limited); an add-tracks failure keeps the Spotify
playlist and reports `partial`; a DB write failure after Spotify success
reports `created` with `persisted: false`.

**Playlist management** — thin JSON handlers over RLS-scoped engines. Sync
fetches one bounded `/me/playlists` metadata map, and
`sync_playlist_spotify_metadata()` applies title, description, temporary
cover URL, `present`/`missing` status, and check time in one
security-invoker write. Spotify is authoritative while a playlist is
reachable, so edit updates Spotify before committing the same details
locally; known-missing playlists remain local-only. Delete tries Spotify
unfollow when reachable but always removes the local row. Recreate reads
stored `playlist_songs` order, skips songs no longer in the user's library,
rebuilds through `build.ts`, and replaces the stored Spotify id/status.
`playlist_tag_summary()` returns every playlist's effective tags in one
RLS-scoped call; the server page fetches the cards and rollup in parallel,
the status panel syncs on mount/manual refresh, and each action cluster owns
only its dialogs and mutations.

## Constraints and invariants

Load-bearing rules the code already satisfies — each is enforced somewhere
and would break quietly if undone; they are not open work. Product reasoning
behind them lives in `HOW-IT-WORKS.md`; this section keeps the enforcement
and the failure mode.

**The browser has no enrichment authority at all.** `/api/enrich` accepts
`processedSoFar` and nothing else — no song id, model, recipe, or rank.
Deciding _when_ to run your own library is the whole of the client's
authority; the database picks the songs, recipe, effort, and batch size, and
the engine resolves the model through server-only `lib/ai/providers.ts`.
Accepting any of those from a client would expose unbounded cost and
shared-data authority.

**The typeahead's candidate pool is gated, not just its results.**
`library_tag_suggestions` shortlists 50 rows _before_ counting anything,
restricted to `is_approved` rows plus rows this caller personally linked.
Results were always caller-scoped; the gate exists because foreign free-form
tags could otherwise fill all 50 slots on a common substring, count 0, get
dropped, and leave the caller an empty dropdown while a tag they own went
unsuggested. Free-form personal tags removed the only bound on that pool's
growth — do not widen the shortlist back to the whole shared vocabulary.

**Personal tags and enrichment run opposite policies on one table.**
`genres`/`moods` hold both, told apart by `is_approved`. Enrichment reads
approved rows and writes nothing; personal tagging writes unapproved rows
freely and reads its own. The insert policies carry
`with check (not is_approved)`, so a client cannot self-approve a row into
the vocabulary the enrichment prompt is built from — approval only happens in
a service-role migration. Making either path "consistent" with the other
breaks the product rule (`HOW-IT-WORKS.md` § Personal tags). Asserted by
`verify:genres`.

**`ensureVocabularyIds` is the only legal vocabulary write path.**
`.upsert(..., { onConflict: 'name' })` _without_ `ignoreDuplicates` compiles
to `ON CONFLICT DO UPDATE`, which fails under the RLS client —
`genres`/`moods` have INSERT but no UPDATE policy. `lib/vocabulary.ts` uses
insert-ignore-duplicates → select; any write that bypasses it breaks
`/api/tags` at runtime with an RLS error.

**Display and selection use two different effective-tag rules, on purpose.**
`library_search_page` / `library_tag_suggestions` apply
`(all AI links − this caller's suppressions) ∪ this caller's own links` with
**no** `ai_confidence` gate; `library_effective_tagged_songs` gates only the
AI branch on `enrichment_status = 'enriched' and ai_confidence > 0.5`, and
`library_selectable_songs` / `library_tag_names` OR the caller's own links
in the same ungated way. "Unifying the duplicated effective-tag logic" silently
breaks one of the two (why each side needs its rule: `HOW-IT-WORKS.md`
§ Finding songs in the library). Stated in the `library_search` migration
header; no verification script asserts it yet (tracked in
`IMPROVEMENTS.md`).

**One Confidence band rule, read by four surfaces.** The row badge
(`getConfidenceBand`), the panel totals (`get_library_enrichment_counts`),
the Library band filter, and the promotion matrix must classify every song
identically. `public.confidence_band()` is the single SQL definition and all
three SQL readers call it; `getConfidenceBand` mirrors it in TypeScript, and
`confidence_band_rank()` orders the same five bands for promotion, mirroring
`CONFIDENCE_BAND_ORDER`. The mirrors stay equivalent only because
`enrichment_status` is CHECKed to `('pending', 'enriched', 'unknown')` —
widen that CHECK and the None band silently swallows the new status. Bands
OR rather than AND in the URL because a song carries exactly one.

**Confidence is rounded before it is thresholded.** `songs.ai_confidence` is
`numeric(3,2)`, so Postgres rounds to 2dp on write; thresholding the raw
value (0.399 → unknown) and then storing 0.40 would contradict the
`< 0.4 → unknown` rule. The engine rounds + clamps, _then_ thresholds, then
writes the rounded value — keeping the cutoff auditable in SQL and
`verify:enrichment` truthful.

**The closed vocabulary is prompt-enforced, not schema-enforced.** The
per-recipe zod schema keeps genres/moods as `z.array(z.string())` with only
a length cap: a hard `z.enum(approvedNames)` would make off-list output
impossible but also invisible, killing the `unmatched_tags` signal for
growing the approved lists. Deliberate trade; flip only with eyes open.
Relatedly, `output_spec` stores bounded parameters, never raw JSON Schema —
the database must not be able to inject an arbitrary shape into a billed API
call.

**Canonical enrichment writes only happen in atomic promotion.**
`SongMetadata` (`lib/spotify/import.ts`) pins import upserts to Spotify
columns; the engine records an attempt and invokes
`promote_song_enrichment_attempt`, which updates the song, AI genres, AI
moods, job, and decision in one transaction. A new service-role write to
those canonical columns or link tables would bypass downgrade and lease
protection.

**The attempts log is append-only, with no door at all.**
`song_enrichment_attempts_immutable` refuses every DELETE — service role
included — and allows only the one-way `pending` → `promoted`/`rejected`
update. That is what makes the derived three-answers-per-rank budget
enforceable. A `purge_song_enrichment_history()` RPC and a matching GUC
escape hatch existed briefly (added `20260816003822`, removed
`20260817013813`) for a reset script that is also gone. A future operation
that must return a song to `pending` has to clear this log — a reset song
with a spent budget is locked the instant it is reset — so it reintroduces a
door deliberately, as one reviewed migration. Do not relax the trigger to
get there.

**gpt-5 models reject non-default `temperature`,** and a small
`maxOutputTokens` starves reasoning tokens (they count against the cap),
truncating the JSON. The engine sets neither; the recipe's
`reasoning_effort`, delivered through `resolveProviderEffortOptions`, is the
intended cost/quality knob.

**`maxDuration` is a ceiling, not a target.** `/api/enrich` exports
`maxDuration = 300` (Vercel Fluid ceiling on Hobby), but legacy non-Fluid
projects cap at 60s — a recipe's `batch_size` and `reasoning_effort` must
keep one call under ~60s or runs die mid-batch on those deploys.

**zod must stay a direct `^4` dependency.** It also exists transitively via
shadcn with a `^3` range; dropping the explicit pin could resolve v3 at the
root and break schema typing subtly.

**Only the proxy may refresh the session token.** `getUser()` rotates the
token within 90s of expiry (auth-js `EXPIRY_MARGIN_MS`), and
`lib/supabase/server.ts` swallows cookie writes in server components — so a
`getUser()` in a page or layout consumes a refresh token whose replacement
is thrown away. The proxy resolves the caller once and publishes it on
`lib/auth/identity.ts` headers; pages and `AccountMenu` read those. The
headers are proxy-owned: every path through `proxy.ts`, the prefetch
early-return included, must strip the inbound copy or a forged `x-user-id`
reaches the render. `/api/*` is the deliberate exception — it re-verifies
through `requireUser`, and route handlers _can_ persist a rotated cookie.

**The proxy deliberately has no fetch retries.** `lib/supabase/fetch.ts` is
wired into `admin.ts` and `server.ts` but **not** `session.ts`: during an
outage, navigations fail `getUser()` fast and fall back to the
`hasAuthCookie` pass-through instead of hanging ~7s per attempt. A future
proxy-level hard auth gate needs the retryable-vs-real distinction `/api/*`
gets from `requireUser`.

**Models are Studio-curated; recipes are sync-authored.** `llm_models` is
operational data edited in Studio. Recipe rows are minted from
`recipes/definitions.ts` by `npm run recipe:sync`: the unique `content_hash`
index makes "changing a parameter mints a new recipe" a database guarantee,
a trigger keeps everything except `label`/`enabled`/`is_default` immutable,
and `sync_enrichment_recipe_activation` swaps the enabled set atomically
(exactly one enabled default). Never edit recipe rows in Studio, and never
seed them from migrations. A vocabulary revision is two steps — approve the
names by migration, then `recipe:sync` to mint recipes that freeze the new
lists — and approvals change nothing a run sees until that mint. Keep ranks
stable across a mint so no song's eligibility moves. What the app can
execute is a capability check — `isSupportedRecipe`
([lib/enrichment/recipes.ts](lib/enrichment/recipes.ts)) plus the provider
resolvers — and a claimed snapshot this build cannot execute faithfully is
released rather than guessed at.

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
- Recipe or prompt change → edit `recipes/definitions.ts` /
  `recipes/prompts/*.md`, then `npm run recipe:sync` (dry-run first) and
  `npm run verify:recipes`. Never edit an `enrichment_recipes` row. A fresh
  database has no recipes until the sync runs — it is part of environment
  setup.
- Env var → `.env.local`, documented in `.env.example`; server-side only
  unless prefixed `NEXT_PUBLIC_`.
