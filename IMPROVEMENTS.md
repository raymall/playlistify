# Improvements & Sharp Edges

The project's work queue, committed with the code: known sharp edges the
codebase currently lives with, and deferred work worth revisiting. It is a
queue, not a changelog — `ARCHITECTURE.md` and `HOW-IT-WORKS.md` describe what
already works. One entry per item:

```md
## <Title>

- **In plain terms:** what's wrong and what we'd do about it, in a sentence or
  two of everyday language — readable without opening the code.
- **Severity:** High | Medium | Low — short reason. (Deferred items use
  **Complexity:** instead — the effort to implement, not the risk of ignoring.)
- **Issue:** what the sharp edge / gap is.
- **Why fix:** what breaks or what we gain.
```

**Entries have no numbers.** Position carries the priority and the title is the
identity — so an entry can be deleted or reordered without renumbering anything
or breaking a reference. Ordering: **Sharp Edges** run by severity (most
dangerous first); **Deferred** run by complexity (quickest wins first). Give
each entry a title distinctive enough to cite, and refer to another entry by its
title.

**Conflicts, duplicates, and staleness — always confirm with the user first.**
This list is a work queue, and the cost of a stale entry is paid at
implementation time, not now. So whenever a new entry, feature, or decision
would duplicate an existing item, contradict one, or make one obsolete:

- **Surface it and ask** which way to resolve — never silently delete an entry,
  and never add a second entry that quietly contradicts an existing one.
- **Prefer updating over adding.** If an entry already covers the ground, amend
  it. Reserve new entries for genuinely new items.
- **When a decision changes, annotate the record it supersedes** so a reader of
  the old entry is never misled by it.
- Entries that become obsolete get **removed on confirmation**, not left to rot.
- **This file holds work, not reference.** An entry that describes something
  already working — an invariant, a deliberate trade, a decision record —
  belongs in `ARCHITECTURE.md` (mechanism) or `HOW-IT-WORKS.md` (product
  reasoning), not here. Move it there rather than leaving a no-op entry in the
  queue.
- **Done means gone.** A completed entry is deleted outright — no ledger, no
  changelog, no "shipped" section. What shipped is described by
  `ARCHITECTURE.md` and `HOW-IT-WORKS.md`; git has the history. Nothing records
  a removed entry, so when you delete one, rewrite any entry that cited it to
  name the thing itself, or the doc that now explains it.

---

## Dependency advisories need a scoped review

- **In plain terms:** the last full dependency install reported security
  advisories, but nobody has classified which ones affect deployed code. Re-run
  the audit with explicit authorization, review the dependency paths, and make
  targeted upgrades rather than applying a blanket automatic fix.
- **Severity:** Medium — the last observed set included high-severity
  advisories, but the install summary did not separate production dependencies
  from development tools.
- **Issue:** the last verified `npm install` result on 2026-07-29 reported 14
  advisories (2 moderate, 12 high). The current count was not re-queried during
  this audit because `npm audit` sends the dependency graph to npm's external
  advisory service and that egress was not authorized. No broad
  `npm audit fix` has been run.
- **Why fix:** determine which advisories are reachable in production, dismiss
  irrelevant development-only paths explicitly, and apply compatible upgrades
  without allowing an automatic fix to rewrite the dependency graph
  indiscriminately.

## Verification count helpers can turn database outages green

- **In plain terms:** two verification scripts can treat "the database did not
  answer" as "there were zero bad rows", so an outage can produce a passing
  result. Make every failed query fail the check.
- **Severity:** Medium — a green verification result can hide the exact
  transport or permission failure the script is supposed to expose.
- **Issue:** `scripts/verify-import.mjs` and
  `scripts/verify-enrichment.mjs` share the same `headCount` shape:
  `{ count: count ?? 0, error }`. Many hard assertions compare only
  `row.count === 0` and never inspect `row.error`. During a live
  `TypeError: fetch failed` streak on 2026-07-29, `verify:import` printed
  `IMPORT OK` while its service-role counts had collapsed to zero.
- **Why fix:** verification must distinguish an empty result from no result.
  Centralize a throwing count helper or require every hard assertion to include
  `error === null`, then apply it to both scripts.

## Weak-song rechecks have no enabled stronger recipe

- **In plain terms:** the guarded recheck system works, but the live catalog has
  no enabled recipe stronger than the one that produced the current weak
  results. The UI now explains that honestly; enabling a canaried stronger
  recipe is the remaining operational step.
- **Severity:** Medium — the feature is safe and truthful, but all 80 current
  None/Low songs are ineligible for improvement.
- **Issue:** the live recipe catalog has nano at rank 100, the default mini
  recipe at rank 200, and the full model at rank 300 disabled. All 80 weak
  songs (72 None, 8 Low as of 2026-08-11) have already reached rank 200,
  leaving zero with an enabled stronger recipe. The job/attempt/promotion path
  has produced four successful promotions, so this is no longer an untested
  code path or a model-selector bug. `library_enrichment_counts()` and the
  per-row recheck state correctly report the remaining rows as having no better
  recipe yet.
- **Why fix:** so the guarded workflow can improve the remaining weak songs.
  The remaining rollout steps, carried over from the retired
  re-enrichment plan: canary attempts and promotions on a small set of existing
  None/Low songs; compare canonical tags before and after every canary
  promotion; check the cost per attempt and per successful promotion; then
  enable the rank-300 recipe (or add another evidence-backed stronger recipe).
  Rollback is disabling job creation/claiming — canonical reads stay on `songs`
  and the link tables, and orphaned attempts/jobs are audit-only.

## Spotify artwork attribution has no brand mark

- **In plain terms:** playlist covers now link directly back to Spotify and are
  shown without cropping, but the nearby attribution is text-only. Add an
  approved Spotify logo treatment beside the existing link.
- **Severity:** Medium — the experience works, but Spotify's platform guidance
  asks apps displaying its visual content to include branded attribution as
  well as a destination link.
- **Issue:** `/playlists` renders Spotify's temporary cover URL inside a link
  to the corresponding playlist and keeps the original artwork intact. The
  card's separate "Open in Spotify" control names the source but does not use
  an official Spotify brand asset.
- **Why fix:** explicit approved branding makes the source unmistakable and
  brings the cover presentation fully in line with Spotify's display guidance.

## The site header forces horizontal scrolling on mobile

- **In plain terms:** the main navigation and account controls stay on one line
  at phone widths, making every page wider than the screen. Add a compact mobile
  header pattern so content can reflow within the viewport.
- **Severity:** Medium — the 375px browser check measured a roughly 631px-wide
  document, clipping the chat and preview panels and failing responsive reflow.
- **Issue:** the site header's brand, three navigation links, theme toggle, and
  account menu are all non-wrapping flex items. Their combined minimum width
  becomes the document width below that threshold.
- **Why fix:** removing the page-level horizontal scroll restores WCAG 1.4.10
  reflow and lets the otherwise responsive chat layout use the real viewport.

## The admin-client allowlist is lint-only

- **In plain terms:** the service-role database client bypasses all privacy
  rules, and a lint allowlist is the main guard against using it in the wrong
  place. That catches the likely mistake, but it is not a type-level boundary.
- **Severity:** Low — the current allowlist catches accidental imports, while
  database RPCs now own the most sensitive enrichment scoping.
- **Issue:** `createAdminClient()` has the same
  `SupabaseClient<Database>` type as the RLS client. A
  `no-restricted-imports` rule limits it to six files, but any allowlisted file
  can still pass that client to a helper expecting a plain Supabase client.
  `lib/chat/library-search.ts`, for example, relies on receiving the RLS client
  for its personal-tag embeds. A branded client type was rejected because
  producing the brand would require the type assertions the repository bans.
- **Why fix:** keep the lint allowlist narrow and add a real user-A-versus-user-B
  isolation test when a second test account is available. `verify:rls` proves
  only that an anonymous caller sees no private rows; it cannot detect a
  service-role read or cross-user leak between authenticated accounts.

## No test proves display and selection stay diverged

- **In plain terms:** filtering the Library by a genre deliberately matches
  songs the chat assistant would refuse to build a playlist from. The rule is
  now written down in three places, but nothing executable enforces it, so a
  refactor that "unifies the duplicated effective-tag logic" would still pass
  every check.
- **Severity:** Medium — nothing is wrong today; the risk is a silent
  regression in a future refactor.
- **Issue:** `library_search_page` / `library_tag_suggestions` apply
  `(all AI links − this user's suppressions) ∪ this user's own links` with **no**
  `ai_confidence` gate; `library_effective_tagged_songs` applies the same set
  gated on `enrichment_status = 'enriched' and ai_confidence > 0.5`. The
  divergence is documented in the `library_search` migration header,
  `ARCHITECTURE.md` § Constraints and invariants, and `HOW-IT-WORKS.md`
  § Finding songs in the library — but no `verify:*` script asserts it.
- **Why fix:** add a verification script asserting the same Low-confidence AI
  tag is findable in Library and unusable in chat. Prose in three files is a
  weak guard for an invariant that spans two features. The Confidence band
  filter now makes the divergence directly reachable — filtering Library by Low
  lists exactly the songs whose AI tags chat refuses — so the assertion has an
  obvious fixture to build on.

## Prompt tag lists still carry a silent 600-name cap

- **In plain terms:** chat shows the model at most 600 genres and 600 moods. The
  current libraries are far below that ceiling, but an unbounded personal
  vocabulary could eventually hide valid searchable tags from the model.
- **Severity:** Low — the largest live effective library vocabulary is
  currently 152 genres and 95 moods (2026-08-11).
- **Issue:** `TAG_LIST_MAX` in `lib/chat/prompt.ts` truncates each kind at 600
  names and appends `', …'`. AI tags come from the closed approved vocabulary
  (currently 407 genres and 113 moods), but personal tags use the open
  `ensureVocabularyIds` path and are unbounded. A sufficiently large personal
  vocabulary would reintroduce a name the search RPC can resolve but the model
  was never shown.
- **Why fix:** keep `verify:chat-prompt`'s no-truncation assertion. If it ever
  trips, bound or redesign personal-tag discovery rather than simply raising a
  prompt-size cap indefinitely.

## Supabase migration catalog cache needs a local container daemon

- **In plain terms:** remote migrations apply, but the CLI warns after each
  push because its optional local schema-comparison container cannot start.
  Start Docker/OrbStack for migration work or document a supported way to
  disable that cache.
- **Severity:** Low — the linked schema applies correctly, but a routine warning
  makes a real migration failure easier to overlook.
- **Issue:** `npx supabase db push` reports that it cannot cache the pg-delta
  migration catalog when no compatible container socket is available. The
  2026-07-29 audit confirmed OrbStack is stopped and the Docker daemon is
  unreachable.
- **Why fix:** clean migration output is easier to trust at a glance, and the
  local catalog cache is restored when the daemon is available.

---

# Deferred

## `isPrefetch` may test a header Next 16 no longer forwards

- **In plain terms:** the proxy skips auth work on speculative page loads. One
  of its three prefetch signals may be dead after the Next 16 upgrade; confirm
  whether it can still reach application code, then delete or document it.
- **Complexity:** Low — one focused runtime probe and a one-line outcome.
- **Issue:** `isPrefetch` in `proxy.ts` checks
  `next-router-prefetch === '1'`, while the installed Next 16 proxy guide says
  internal Flight headers, including `next-router-prefetch`, are stripped from
  the request. A curl probe confirmed `purpose` and `sec-purpose` take the
  prefetch branch, but the internal-header case remained inconclusive.
- **Why fix:** dead code in the auth path reads as protection that is not
  actually present.

## Recheck never explains that the result is shared

- **In plain terms:** the per-song `Request recheck` button changes analysis
  every other user of that song sees, and only when the new answer is better.
  The UI says none of that, so "Checked, not improved" reads like a failure
  rather than the guard working.
- **Complexity:** Low — one line of copy near the recheck control, or an
  addition to the existing Confidence popover.
- **Issue:** carried over from the retired re-enrichment plan, which specified
  the copy "We only replace shared analysis when the new result is better.
  Improvements apply everywhere this song appears." `library-recheck-action.tsx`
  renders only the state label, and `library-confidence-info.tsx` explains the
  bands without mentioning sharing or the promotion guard.
- **Why fix:** the recheck states are truthful but unexplained; a sentence
  turns a confusing outcome into a visibly deliberate one. Keep the existing
  rule that ranks, provider names, retry counts, and global request counts stay
  out of the consumer UI.

## The live auth token-rotation settings have never been read

- **In plain terms:** the app has evidence that token rotation is currently
  healthy, but the authoritative reuse window and related live auth settings
  have never been checked in the Supabase dashboard.
- **Complexity:** Low — read the dashboard values and record them in the
  appropriate operational documentation.
- **Issue:** `supabase/config.toml` contains
  `refresh_token_reuse_interval = 10`, but that file configures only a local
  `supabase start` stack; this project uses a linked remote and never pushes
  that auth configuration. The proxy now owns refresh and logs null-user
  classification, which removed the old in-app race, but it does not tell us
  the live dashboard policy.
- **Why fix:** knowing the real reuse interval and session policy turns auth
  recovery behavior from an assumption into an explicit operational contract.

## Granted Spotify scopes are not recorded

- **In plain terms:** Playlistify requests the scopes it needs but does not keep
  a record of what a user actually granted. It discovers an older connection
  lacks playlist-read access only when the first status check fails.
- **Complexity:** Low — persist the granted scope string at sign-in and check it
  before making scope-specific Spotify calls.
- **Issue:** existing refresh tokens cannot gain `playlist-read-private`, and
  `spotify_tokens` does not store the authorization's granted scopes. The
  inline reconnect state is therefore driven by a failed `/me/playlists` call.
- **Why fix:** a stored scope set would make reconnect prompts immediate and
  distinguish missing authorization from endpoint or token failures.

## Collaborative playlists need an additional read scope

- **In plain terms:** a Playlistify-created playlist can later be made
  collaborative in Spotify, but the current status scan may then stop seeing
  it. Request collaborative-playlist read access before supporting that state.
- **Complexity:** Low — add `playlist-read-collaborative`, reauthorize existing
  users, and add the converted-playlist case to the Spotify smoke test.
- **Issue:** `/me/playlists` includes collaborative playlists only when
  `playlist-read-collaborative` is granted. Playlistify currently requests
  private-playlist read access plus the modify scopes, matching the confirmed
  management scope but not a later collaborative conversion in Spotify.
- **Why fix:** without the extra scope, a collaborative playlist can be marked
  "Deleted in Spotify" even though it still exists there.

## Playlist reachability changes wait for a full sync

- **In plain terms:** if Spotify reports during an edit or delete that a
  playlist has just disappeared, the card does not learn that immediately. It
  updates on the next automatic or manual status refresh.
- **Complexity:** Low — recognize a playlist-specific not-found response and
  update that row's cached reachability without broadening every 403 into the
  same case.
- **Issue:** `spotify_status` is intentionally written only by the bulk
  `/me/playlists` sync. Mutation calls do not opportunistically mark one row
  missing when Spotify returns 404, so a just-unfollowed playlist can look
  reachable until the next sync.
- **Why fix:** targeted 404 handling would shorten the stale window while
  preserving the full sync as the authoritative reconciliation pass.

## Chat tool contracts lack a live-provider smoke test

- **In plain terms:** the chat tool schemas are covered by local parsing and
  database checks, but no automated test asks the configured provider to call
  both tools. Add one cheap live smoke case.
- **Complexity:** Low — one scripted chat turn when a key and model are
  intentionally available.
- **Issue:** `search_library` and `propose_playlist` use strict, fully required
  input shapes with empty arrays/nulls standing in for optional filters.
  Current schemas include bounded arrays, but there is no automated provider
  contract test for schema acceptance, the `includeAllMatches: true` default
  instruction, or the expected empty-filter shape.
- **Why fix:** provider or model changes can break tool calling while all local
  TypeScript and database verification remains green.

## Vocabulary snapping is silent

- **In plain terms:** near-duplicate tag names are silently rewritten to an
  existing name. If the similarity threshold ever merges two genuinely
  different tags, there is no runtime signal.
- **Complexity:** Low — log or count each successful rewrite.
- **Issue:** `matchApprovedVocabulary` and `ensureVocabularyIds` in
  `lib/vocabulary.ts` record full misses through `unmatched_tags`, but successful
  fuzzy snaps do not record the input, canonical result, or score.
  `verify:genres` checks today's catalog only.
- **Why fix:** a from/to/score signal makes false merges and threshold drift
  observable without waiting for users to notice strange tags.

## Chat rebuilds the tag summary on every message

- **In plain terms:** each chat turn recounts the library and rebuilds the
  complete tag menu before the first model token. Cache it briefly or invalidate
  it after enrichment/tag changes.
- **Complexity:** Low — a short-lived per-user cache with explicit invalidation.
- **Issue:** every `POST /api/chat` runs two count queries plus one or more
  `library_tag_names()` pages through `getLibraryTagSummary`. The result is
  reused within that request but not across turns.
- **Why fix:** this is avoidable critical-path latency. Invalidation must cover
  enrichment promotions, suppressions, personal tags, and library imports so
  the model never sees a stale searchable vocabulary.

## Prompt suggestions cost one model call per tab

- **In plain terms:** prompt ideas stay stable within one tab, but each new tab
  buys its own set and there is no way to ask for a fresh set in place. Consider
  an account-scoped cache and an explicit shuffle control if usage justifies it.
- **Complexity:** Low — choose a cache lifetime/scope, then add one small control.
- **Issue:** `use-prompt-suggestions.ts` caches only in `sessionStorage`. Several
  open tabs each call `GET /api/prompt-suggestions` once, and the empty state has
  no user-facing shuffle action.
- **Why fix:** a shared cache would reduce duplicate model spend, while an
  explicit refresh would let users trade one intentional call for new ideas.

## `verify:chat-prompt` mirrors two RPCs and misses the third

- **In plain terms:** the chat verifier rewrites database behavior in
  TypeScript instead of calling the real functions. The copy can drift while
  the real SQL changes, and effective tag matching is not exercised end to end.
- **Complexity:** Low to Medium — authenticate the verifier as a real user or
  add a safe test harness around the security-invoker RPCs.
- **Issue:** `scripts/verify-chat-prompt.mts` uses the service-role client and
  mirrors `library_tag_names()` and `library_selectable_songs()` for one
  explicit `user_id`. It also reconstructs suppressions manually, while the app
  now relies on a third RPC, `library_effective_tagged_songs()`, that the script
  does not call.
- **Why fix:** the verifier should exercise the same SQL contracts the app uses;
  otherwise a green result can prove only that the TypeScript mirror still
  agrees with itself.

## Clean up orphaned unapproved vocabulary rows

- **In plain terms:** personal tags can leave unapproved global vocabulary rows
  behind after their last user link disappears. Add a safe periodic cleanup or
  fold it into the review workflow.
- **Complexity:** Low — reuse the remap/delete logic already present in
  `scripts/reset-enrichment.mts`.
- **Issue:** the live database currently has two unapproved genre rows (one
  still referenced by a personal tag, one orphaned) and one unapproved mood row
  (still referenced). Nothing rechecks these rows when a personal tag is
  removed or when the approved vocabulary grows.
- **Why fix:** without a sweep, the shared vocabulary accumulates unused
  unapproved rows indefinitely.

## Large proposals are echoed into model context

- **In plain terms:** the full playlist proposal is sent to the preview panel
  and back into the model's context. Large playlists therefore pay a token cost
  proportional to every track.
- **Complexity:** Low — split the model-facing summary from the UI payload when
  large proposals become common.
- **Issue:** `propose_playlist` returns the complete proposal as its tool result.
  `SCAN_CAP` and `SONGS_MAX` bound the worst case at 1,000 tracks, but a large
  `includeAllMatches` proposal still round-trips every track object through the
  next model step.
- **Why fix:** return a compact `{ count, name }` result to the model and stream
  the full track list to the UI as a separate data part so playlist size stops
  driving context cost.

## `commits.md` and `pull-requests.md` load twice

- **In plain terms:** project and personal rule files contain the same commit
  and pull-request instructions, so both copies consume context in every Claude
  session. Choose one source deliberately.
- **Complexity:** Low — remove one pair or accept the duplication knowingly.
- **Issue:** `.claude/rules/{commits,pull-requests}.md` and the corresponding
  `~/.claude/rules/` files differ only by Markdown blank lines and have no
  `paths` frontmatter. Dropping the project copies would also remove shared
  conventions for collaborators; dropping the personal copies would remove the
  rules from repositories that do not carry their own.
- **Why fix:** make the team-sharing versus context-cost trade explicit instead
  of paying a silent duplicate-rule tax.

## `Bash(npm run *)` pre-approves every script

- **In plain terms:** local Claude settings approve any current or future
  `npm run` command, including a script that could later deploy or mutate the
  database. Replace the wildcard with the safe commands actually used.
- **Complexity:** Low — enumerate exact read/build/verify scripts.
- **Issue:** `.claude/settings.local.json` contains `Bash(npm run *)`. That rule
  has no script-name or flag analysis, so adding a destructive package script
  automatically makes it pre-approved.
- **Why fix:** exact permissions for typecheck, lint, formatting, and selected
  `verify:*` commands preserve convenience without granting future scripts a
  blank cheque.

## Version and measure the enrichment system prompt

- **In plain terms:** the enrichment prompt is still its original unmeasured
  draft. The recipe catalog labels it `prompt-v1`, but code does not prove that
  the text still matches that version. Add an explicit prompt registry/version
  check and evaluate revisions before enabling them.
- **Complexity:** Medium — the version guard is small; proving a revision is
  better depends on the enrichment eval harness.
- **Issue:** `SYSTEM_PROMPT` remains hardcoded in
  `lib/enrichment/engine.ts`. Claimed recipes carry `prompt_version`, and
  `isSupportedRecipe` accepts the literal `prompt-v1`, but no hash or registry
  binds that version to the prompt text. An innocent text edit without a new
  recipe would make future immutable attempts claim the old recipe identity.
  The prompt itself has never been A/B tested.
- **Why fix:** map version strings to immutable prompt text, fail unsupported
  versions, and create a new recipe row for every measured prompt revision.
  Candidate improvements include clearer genre-versus-mood guidance and
  examples, while preserving the instruction not to guess unknown recordings.

## Remove legacy model-rank and omission residue

- **In plain terms:** the guarded queue replaced the old selector and omission
  counter, but dead helpers, columns, comments, and verification checks still
  describe the retired system. Remove them after rollout compatibility is no
  longer needed.
- **Complexity:** Medium — a cleanup migration plus script and documentation
  updates through the full database-change sequence.
- **Issue:** `lib/enrichment/rank.ts` still exports unused `outranks` and
  `MAX_ENRICHMENT_ATTEMPTS`; its comments describe the deleted selector.
  `songs.enrichment_attempts` and `songs.enrichment_skipped_rank` remain zero
  while the real brake is `song_enrichment_jobs.attempt_count`.
  `verify:enrichment` still asserts and reports those legacy fields, and
  `reset:enrichment` resets them. `llm_models.enrichment_rank` also remains as a
  rollout compatibility source even though `enrichment_recipes.enrichment_rank`
  is authoritative. Do not remove the canonical `songs.enrichment_rank` or
  highest-attempted recipe fields; those still participate in promotion.
- **Why fix:** stale safeguards are worse than obvious dead code because they
  imply coverage. Retire the compatibility fields, move any still-useful
  checks into `verify:re-enrichment`, and leave one recipe-based ranking model.

## Database CHECK statuses generate as plain strings

- **In plain terms:** database status fields are constrained at runtime, but
  generated TypeScript accepts any string. Typos reach the database or fallback
  branches instead of failing at compile time.
- **Complexity:** Medium — shared unions with narrowing, or Postgres enums plus
  regenerated types and call-site updates.
- **Issue:** `songs.enrichment_status`, job `status`, attempt `outcome`, and
  attempt `decision` use SQL `CHECK` constraints, so `lib/supabase/types.ts`
  generates `string`. Some external results are narrowed manually, but
  `getConfidenceBand` still accepts an arbitrary status string and treats every
  unknown non-`enriched` value as `none`.
- **Why fix:** central unions/readers catch misspellings and unexpected database
  values close to the boundary instead of silently classifying them.

## Users cannot report incorrect shared analysis

- **In plain terms:** users can hide a tag privately and request a recheck for
  weak songs, but they still cannot flag a confident shared result as factually
  wrong. Add a moderated report path that never edits canonical data directly.
- **Complexity:** Medium — reasoned report UI, ownership-checked API, RLS table,
  deduplication/rate limits, and an owner review workflow.
- **Issue:** guarded promotion now exists, but normal user flows still
  correctly refuse to re-analyze Medium/High rows. A mistaken confident result
  therefore has no feedback path beyond private suppression. Reports need
  reason categories (wrong recording, genre, mood, or attributes), optional
  detail, abuse controls, and aggregation.
- **Why fix:** reviewed reports would expose high-confidence failures that model
  self-confidence cannot detect and provide hard cases for the eval corpus,
  without giving one user authority over shared canonical tags.

## Classify hardcoded constants versus real configuration

- **In plain terms:** two enrichment limits are configurable, while page sizes,
  retry budgets, leases, and timeouts are spread through code and SQL. Decide
  which are operational knobs and which are invariants; do not move them all
  blindly.
- **Complexity:** Medium — a code/SQL sweep plus documentation for the values
  that remain intentionally fixed.
- **Issue:** `ENRICHMENT_BATCH_SIZE` and
  `ENRICHMENT_MAX_SONGS_PER_RUN` use clamped environment variables. Other
  possible tunables remain hardcoded: library/import page sizes, Supabase retry
  ladders, Spotify token expiry buffer, enrichment-panel retry budgets, the
  600-second job lease, and the 3-second queue wait. The refactor also added
  policy constants that should stay fixed in code/database: the three-attempt
  job cap, confidence thresholds, provider/API chunk limits, and recipe version
  identifiers.
- **Why fix:** classify values by purpose. Move only deployment-specific knobs
  behind clamped server-side configuration, keep protocol and safety bounds in
  code/SQL, and document every new environment variable in `.env.example` and
  `ARCHITECTURE.md`.

## Fuzzy vocabulary snapping reads the whole vocabulary per write

- **In plain terms:** every saved tag loads a whole genre or mood vocabulary
  and scans it in JavaScript. Fine today; move matching into indexed SQL if the
  vocabulary grows.
- **Complexity:** Low to Medium — `pg_trgm` is already installed (the
  `library_search` migration added it into the `extensions` schema), so this is
  now trigram indexes on `genres.name` / `moods.name` plus a matching function,
  through the full migration sequence.
- **Issue:** `matchApprovedVocabulary` and `ensureVocabularyIds` are
  O(new names × existing names), and the Supabase select path has a default
  1,000-row response ceiling. The approved set is currently 407 genres and 113
  moods, while unapproved personal rows can grow without a bound.
- **Why fix:** server-side `similarity()`/`%` lookups with trigram indexes avoid
  full-table transfers and remove the hidden 1,000-row ceiling.

## Personal tags share the global vocabulary tables

- **In plain terms:** user-created tags are private at the link level but their
  names are inserted into global genre/mood tables, visible to every signed-in
  user. Give personal tags a real namespace.
- **Complexity:** Medium — a source discriminator or table split plus tag,
  chat, RPC, and migration updates.
- **Issue:** AI enrichment is correctly closed to approved rows, but
  `lib/tags.ts` calls `ensureVocabularyIds`, which inserts freeform unapproved
  rows into shared `genres`/`moods`. Only `user_genres`/`user_moods` ownership
  is private.
- **Why fix:** separating personal vocabulary prevents one user's invented
  names from becoming globally readable operational data and simplifies
  cleanup/promotion rules.

## `unmatched_tags` has no review or promotion workflow

- **In plain terms:** off-list model tags are counted, but approving a useful
  candidate still requires manual SQL. Add a small owner tool or script.
- **Complexity:** Medium — an owner-only list and promote action, or a focused
  operational script.
- **Issue:** `unmatched_tags` records kind, normalized name, occurrence count,
  and timestamps. There is no workflow to review frequent candidates, promote
  one into the approved vocabulary, version that vocabulary change, and decide
  whether affected songs should be rechecked.
- **Why fix:** the signal is useful only when review is cheap and promotion
  preserves recipe/vocabulary identity.

## The enrichment queue and promotion path have no metrics

- **In plain terms:** the guarded queue records every attempt and decision in
  the database, but nothing reports on them. Whether the queue is backing up,
  how often weak songs actually improve, and what a promotion costs are all
  questions that currently need hand-written SQL.
- **Complexity:** Medium — the data already exists; this is a reporting surface
  (a script, a saved view, or a small owner page) plus deciding what to watch.
- **Issue:** carried over from the retired re-enrichment plan, which specified
  per-recipe measures that were never built: queue depth and oldest queued age;
  jobs coalesced and duplicate billable calls avoided; attempts by outcome and
  rejection reason; `None → recognized` and `Low → Medium/High` promotion rates;
  cost and latency per attempt and per successful promotion; omission and
  lease-expiry rates; canonical rollback/transaction failures; and songs
  improved weighted by the number of libraries containing them.
- **Why fix:** these are the numbers that would prove the stated success
  criteria — no canonical downgrades, no stale AI tags surviving a promotion,
  concurrent requests causing one billable job — instead of assuming them.
  Report by recipe only; never expose personal tags.

## Cross-provider recipe ranking needs local evals

- **In plain terms:** model strength for this app means recognizing obscure
  recordings, not winning a general coding leaderboard. Rank future providers
  on the app's own holdout set.
- **Complexity:** Medium once the shared eval harness exists.
- **Issue:** `enrichment_recipes.enrichment_rank` is authoritative. The live
  catalog currently contains only three OpenAI recipes, whose within-provider
  ordering is understandable. A future Claude/Grok/other recipe cannot be
  placed defensibly by reputation because general benchmarks do not measure
  music-recognition recall or tag quality.
- **Why fix:** score each candidate recipe on the same hard, hand-labeled songs
  and approved vocabulary. A wrong rank makes the promotion guard confidently
  enforce the wrong direction across every shared song.

## Playlist length has no complete policy

- **In plain terms:** playlist length is either every match or a model-picked
  subset. Add explicit count/duration intent, a documented default, and a
  post-proposal trim control.
- **Complexity:** Medium — prompt/tool design plus one preview-panel affordance.
- **Issue:** `includeAllMatches` represents exhaustive requests; `false` makes
  the model enumerate a subset. The schema cannot directly express "20 songs",
  "about an hour", "my commute", or a sensible unspecified default.
  `durationMs` is already available on every candidate.
- **Why fix:** length is one of the most visible playlist properties. A
  `lengthIntent` such as `all | count | duration` and a preview adjustment would
  make it explicit instead of forcing track-by-track deletion.

## Per-run cap and batch size are unmeasured cost/quality knobs

- **In plain terms:** 20 songs per model call and 500 per button run are
  educated guesses. Jobs now survive a pause safely, but users still need to
  continue large runs manually and the accuracy/cost tradeoff is unknown.
- **Complexity:** High — requires the eval harness before tuning is defensible.
- **Issue:** `ENRICHMENT_BATCH_SIZE` defaults to 20 and
  `ENRICHMENT_MAX_SONGS_PER_RUN` to 500. The queue refactor removed the risk of
  losing work at the cap, but did not measure whether smaller batches improve
  recognition/tag quality enough to justify more calls, or whether the run cap
  is the right spending brake.
- **Why fix:** benchmark batch sizes, models, and `reasoningEffort` on the same
  holdout corpus, then retune. With evidence, consider auto-continuing behind a
  spend ceiling and pausing on quality/cost signals rather than a raw song
  count alone.

## Enrichment evals are the shared blocker

- **In plain terms:** several quality decisions need the same repeatable test:
  known songs, known-good labels, and one scorer. Build that once instead of
  tuning prompts, ranks, and batch sizes by feel.
- **Complexity:** High — the expensive part is hand-labeling a representative
  holdout set; the runner and reports are comparatively small.
- **Issue:** prompt revision, cross-provider recipe ranks, batch-size tuning,
  reasoning effort, and web-search fallback all need comparable evidence. The
  immutable `song_enrichment_attempts` table now provides a natural result
  shape (outcome, confidence, canonical tag names, decision), but there is no
  fixed corpus or scorer.
- **Why fix:** build one harness that measures, in order:
  recognition at the rounded confidence threshold; genre/mood agreement after
  the same approved-vocabulary matcher; tag-count distribution; promotion rate;
  latency and cost. Weight the corpus toward current None rows, rejected weak
  attempts, and frequent unmatched tags, and keep known-correct answers outside
  the model-generated data.

## Web-search fallback needs its own recipe lane

- **In plain terms:** stronger models can re-ask from their weights, but niche
  songs often require genuinely new web evidence. Add search as a separate,
  resumable, eval-gated analysis lane.
- **Complexity:** High — per-song search, evidence handling, new cost/latency,
  and a distinct recipe/worker contract.
- **Issue:** the guarded queue now bounds omissions and provider failures per
  recipe, but the standard worker still sends a multi-song structured-output
  call. Appending sequential web searches after that call would exceed the
  request budget and could re-bill completed LLM work on retry. Search results
  also introduce untrusted, off-list text that must pass the same vocabulary
  gate and promotion policy.
- **Why fix:** model web search as independently queued evidence with its own
  recipe identity and attempts, then prove on the hard eval corpus that it
  improves recall enough to justify its cost before enabling it.
