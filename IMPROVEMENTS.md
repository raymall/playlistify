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
- **Issue:** as of 2026-08-16 `npm audit` reports 11 advisories (2 moderate,
  9 high), down from the 12 reported at the 2026-08-11 GSAP install and 14 on
  2026-07-29. Nothing classifies production reachability. No broad
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
  `scripts/verify-enrichment.mjs` share one `headCount` helper in
  `scripts/lib/verify.mjs` that returns `{ count: count ?? 0, error }` and
  leaves the error check to callers. Many hard assertions compare only
  `row.count === 0` and never inspect `row.error`. During a live
  `TypeError: fetch failed` streak on 2026-07-29, `verify:import` printed
  `IMPORT OK` while its service-role counts had collapsed to zero.
- **Why fix:** verification must distinguish an empty result from no result.
  The helper is now centralized in `scripts/lib/verify.mjs` but does not
  throw; make it throw on a non-null `error`, or require every hard assertion
  to include `error === null`.

## `verify:re-enrichment` silently checks only the first 1000 rows

- **In plain terms:** the re-enrichment verifier fetches jobs and attempts with
  a plain select, so PostgREST caps it at 1000 rows and it checks a slice while
  reporting as though it checked everything. It passed on 2026-08-15 printing
  `attempts=1000` when the table held 1059.
- **Severity:** Medium — the invariants it guards (three answers per rank, no
  band regression, active attempt promoted) are exactly the ones a bug would
  break on the _newest_ rows, which are the ones outside the window.
- **Issue:** `scripts/verify-re-enrichment.mts` calls
  `service.from('song_enrichment_attempts').select(...)` and
  `.from('song_enrichment_jobs').select(...)` with no range paging.
  `verify-enrichment.mjs` already pages in a 1000-row loop (the zero-tag scan),
  so the pattern exists in the repo and was simply not applied here. The counts it derives —
  `answersByRank`, `promotedBySong` — are aggregates over the truncated set, so
  a violation on row 1001 reads as a pass. A full-table SQL check confirmed the
  invariants genuinely held at the time; only the coverage was short.
- **Why fix:** an assertion that quietly narrows its own scope as the table
  grows is worse than no assertion, because the PASS line gets more reassuring
  exactly as coverage drops. Page both selects, or move the aggregates into SQL
  and assert on the returned scalars.

## Rank 300 is measured on weak songs but not on a full High backfill

- **In plain terms:** the strongest recipe has now run against real songs, and
  the numbers say it earns its cost on songs that are already good and not on
  the ones the mini recipe gave up on — the opposite of the intuition that
  motivated enabling it. What is still unmeasured is a backfill run to
  completion.
- **Severity:** Medium — the lever is no longer unknown, but the measured shape
  is counter-intuitive enough that acting on the old intuition would waste
  real money.
- **Issue:** measured 2026-08-15 on the pre-reset library, rank 300 =
  `openai:gpt-5.4`, effort `low`, batch 20:
  - **Below-High songs** (48 None / 5 Low / 26 Medium, all locked after three
    tries at rank 200): **3 promotions from 235 attempts — 1.3%**. These are
    songs the mini recipe could not recognize, and the full model mostly could
    not either. Escalation is close to worthless here.
  - **High songs** with `enrich_all_songs = true`: 244 songs tried, **128
    promoted — 52.5%**, at **2.05 calls per song** (127 `stronger_recipe`, 460
    `would_downgrade` refusals, 0 downgrades reaching canonical). Roughly half
    of High rows do get a better High answer from the stronger recipe.
  - The run was stopped at 244 of 1793 High songs; the remaining ~3,200 calls
    were not spent, so the 52.5% rests on a 14% sample and the full-backfill
    cost is still an extrapolation.
- **Why fix:** the two settings want opposite decisions, which the single
  "enable rank 300" framing hides. Enabling rank 300 alone mostly buys 1.3%
  promotions on hopeless songs; `enrich_all_songs` is where the value is, and
  it is also the expensive half. Before a real backfill: widen the High sample
  beyond 244, price 2.05 calls/song across the library, and decide whether a
  52.5% band-preserving re-roll is worth it at all — a High song that stays
  High gains nothing a user can see, only fresher tags under the current
  vocabulary. Rollback is disabling job creation/claiming; canonical reads stay
  on `songs` and the link tables, and orphaned attempts/jobs are audit-only.

## Recognized-but-unmatched has no outcome of its own

- **In plain terms:** when the model recognizes a song confidently but every tag
  it returns is outside the approved vocabulary, the song is filed as if it were
  never recognized at all — and it spends one of its three tries doing it, even
  though asking again cannot change the answer.
- **Severity:** Medium — it costs real analyses and it misreports the result.
  Any confidently recognized song whose tags all fall outside the approved
  vocabulary lands in this state and is filed None (the pre-reset library held
  at least four; the re-imported library has none yet as of 2026-08-16).
- **Issue:** `normalizeCandidate` in `lib/enrichment/candidates.ts` treats _zero
  surviving tags_ and _confidence below 0.4_ as the same thing and emits
  `unknown`. The state is still distinguishable — an `unknown` outcome whose
  confidence cleared the 0.4 cutoff — but nothing reads it that way:
  `enrichment_attempts_remaining_at_rank` counts it as an answer, and the
  Library calls it None. Not charging for it was considered and rejected: with
  no trigger that re-opens songs when the vocabulary changes, a free retry would
  re-analyze and re-bill the same song on every run of **Analyze & improve**,
  forever — and now that the bulk run is the only way in, that is every run.
- **Why fix:** a dedicated `unmatched` outcome would let the row say what
  actually happened and let the budget rule treat it correctly, rather than
  choosing between over-charging and unbounded charging. It touches the outcome
  CHECK, the promotion function, `lib/enrichment/policy.ts`, and both verify
  scripts, so it is a deliberate change rather than a one-line fix — and it only
  pays off alongside a vocabulary-change re-open policy (see
  `unmatched_tags` has no review or promotion workflow).

## The rank ratchet runs before the omitted/failed early return

- **In plain terms:** if the model skips a song while a stronger recipe is
  running, the song is recorded as having reached that stronger recipe anyway —
  so it loses access to the recipe it was previously eligible for, without ever
  having been analyzed by either.
- **Severity:** Medium — no wrong data is written, and capped re-analysis
  softened it (the song keeps a full budget at the rank it ratcheted to), but a
  rank it never answered at still costs it every enabled recipe below.
- **Issue:** `promote_song_enrichment_attempt` advances
  `songs.highest_attempted_recipe_rank` (current definition in migration
  `20260815231831_drop_legacy_rank_and_omission_columns.sql`, around line 175)
  before the branches that return early for `omitted` and `failed`
  outcomes. `next_enrichment_recipe` then excludes every rank below the
  ratcheted one, because promotion would reject those as `superseded`.
- **Why fix:** the ratchet should record ranks that produced an answer.
  Omissions and failures already have their own bounded allowance in
  `song_enrichment_jobs.attempt_count`; they should not also consume rank
  eligibility.

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

## Landing hero text contrast changes with the shader frame

- **In plain terms:** the wordmark and tagline sit directly on an animated light
  field, so bright frames can wash them out. Find a frame-independent treatment
  that preserves the clean, panel-free hero design.
- **Severity:** Medium — shader estimates show frames below the required text
  contrast, but the current shadow still needs direct sampling.
- **Issue:** the tagline deliberately uses only a subtle text shadow, and the
  wordmark relies on the shader's protected lane. Reconstructing the tone-mapped
  shader output puts a bright patch near 1.8:1 against their light colors; text
  shadow may improve the glyph-edge contrast but has not been measured across
  representative frames.
- **Why fix:** a stable treatment keeps both pieces of hero copy readable
  throughout the animation and removes a frame-dependent WCAG 1.4.3 failure
  without bringing back a broad dark panel.

## The landing cutout paints above every hero layer

- **In plain terms:** the Chandler cutout is a sibling painted over the entire
  isolated hero, so it can cover copy or controls at cramped sizes. Put it in a
  stacking layer between the canvas and the interactive hero content.
- **Severity:** Medium — the current widths keep the new tagline clear, but the
  CTA has little clearance and future hero content can be silently obscured.
- **Issue:** `.mesh-landing` creates an isolated stacking context while the
  image in `app/page.tsx` has `z-10`. The wordmark, tagline, and CTA z-indexes
  are trapped inside the section and can never paint over that sibling.
- **Why fix:** a deliberate shared stacking context would let the cutout stay
  above the mesh while guaranteeing that readable and interactive content wins.

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

## The landing cutout requests an undersized desktop image

- **In plain terms:** large screens render the cutout at 25rem but tell the
  image optimizer it will be only 16rem, so the browser can choose a blurry
  source. Make `sizes` match the responsive width classes.
- **Severity:** Low — the page still works, but desktop visitors may download a
  256px candidate and upscale it to roughly 400px.
- **Issue:** `app/page.tsx` pairs `lg:w-100` with
  `sizes='(min-width: 1024px) 16rem, …'`; those two declarations disagree by
  about 36% at the large breakpoint.
- **Why fix:** accurate sizing lets Next.js choose a sharp-enough candidate
  without guessing high and wasting bandwidth at smaller breakpoints.

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
- **Severity:** Low — live effective library vocabularies sit far below the
  ceiling (the whole approved vocabulary is 407 genres and 140 moods).
- **Issue:** `TAG_LIST_MAX` in `lib/chat/prompt.ts` truncates each kind at 600
  names and appends `', …'`. AI tags come from the closed approved vocabulary
  (currently 407 genres and 140 moods), but personal tags are free-form through
  the open `ensureVocabularyIds` path and are unbounded — every distinct string
  a user types is a new row. A sufficiently large personal vocabulary would
  reintroduce a name the search RPC can resolve but the model was never shown.
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
- **Issue:** `spotify_status` is written only by the bulk `/me/playlists`
  sync (plus recreate, which resets a row to `present` after re-creating the
  playlist). Mutation calls do not opportunistically mark one row
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
- **Complexity:** Low — a zero-reference delete: unapproved rows with no
  `user_genres`/`user_moods` link. Never delete a referenced row; a free-form
  tag is the user's own word.
- **Issue:** the live database currently has three unapproved rows — two
  genres and one mood, all orphaned since the 2026-08-16 reset wiped the
  personal-tag links that referenced them. Nothing rechecks these rows when a
  personal tag is removed. `scripts/reset-enrichment.mts` was the only code
  that ever swept them and it was deleted on 2026-08-16, so there is now no
  cleanup at all — while free-form tagging means every distinct string a user
  types adds a row.
- **Why fix:** without a sweep, the shared vocabulary accumulates unused
  unapproved rows indefinitely, and nothing bounds the rate any more.

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
  `~/.claude/rules/` files carry the same rules — `pull-requests.md` identical
  modulo blank lines, `commits.md` with minor wording differences (voice, one
  extra branching bullet in the project copy) — and have no
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

- **In plain terms:** users can hide a tag privately, but they still cannot flag
  a confident shared result as factually wrong. Add a moderated report path that
  never edits canonical data directly.
- **Complexity:** Medium — reasoned report UI, ownership-checked API, RLS table,
  deduplication/rate limits, and an owner review workflow.
- **Issue:** there is no per-song request of any kind any more — the recipe
  decides what runs — and a High song is only revisited when an operator enables
  a stronger recipe with `enrich_all_songs`. A mistaken confident result
  therefore has no feedback path beyond private suppression, and no way to reach
  the person who would decide whether a backfill is warranted. Reports need
  reason categories (wrong recording, genre, mood, or attributes), optional
  detail, abuse controls, and aggregation.
- **Why fix:** reviewed reports would expose high-confidence failures that model
  self-confidence cannot detect and provide hard cases for the eval corpus,
  without giving one user authority over shared canonical tags.

## Classify hardcoded constants versus real configuration

- **In plain terms:** one enrichment limit is an env var and two more became
  recipe columns, while page sizes, retry budgets, leases, and timeouts are
  spread through code and SQL. Decide
  which are operational knobs and which are invariants; do not move them all
  blindly.
- **Complexity:** Medium — a code/SQL sweep plus documentation for the values
  that remain intentionally fixed.
- **Issue:** `ENRICHMENT_MAX_SONGS_PER_RUN` is the one clamped environment
  variable left; batch size and reasoning effort moved onto
  `enrichment_recipes`, which is a third category the original sweep did not
  anticipate — data that belongs to a versioned identity rather than to code or
  to deployment. Other
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

## Personal tags share the global vocabulary tables

- **In plain terms:** user-created tags are private at the link level but their
  names are inserted into global genre/mood tables, visible to every signed-in
  user. Give personal tags a real namespace.
- **Complexity:** Medium — a source discriminator or table split plus tag,
  chat, RPC, and migration updates.
- **Issue:** AI enrichment is correctly closed to approved rows, but
  `lib/tags.ts` calls `ensureVocabularyIds`, which inserts freeform unapproved
  rows into shared `genres`/`moods`. Only `user_genres`/`user_moods` ownership
  is private. Free-form personal tags make this sharper, not different: every
  distinct string any user types becomes a globally readable row, and nothing
  bounds how many. The names do not leak into another user's typeahead
  (`library_tag_suggestions` ends with `where c.total > 0`), but they are
  readable by any signed-in user with a direct `select` on `genres`/`moods`.
- **Why fix:** separating personal vocabulary prevents one user's invented
  names from becoming globally readable operational data and simplifies
  cleanup/promotion rules.

## `unmatched_tags` has no review or promotion workflow

- **In plain terms:** off-list model tags are counted, but approving a useful
  candidate still requires manual SQL. Add a small owner tool or script.
- **Complexity:** Medium — an owner-only list and promote action, or a focused
  operational script, plus a decision on what a vocabulary revision re-opens.
- **Issue:** `unmatched_tags` records kind, normalized name, occurrence count,
  and timestamps. There is no workflow to review frequent candidates, promote
  one into the approved vocabulary, version that vocabulary change, and decide
  whether affected songs should be rechecked. The 2026-08-13 widening did all
  four by hand — 27 moods promoted by migration, a new `vocabulary-v2` recipe
  generation cut to carry them, and nothing re-opened — which is what the
  workflow would have to automate.
- **Why fix:** the signal is useful only when review is cheap and promotion
  preserves recipe/vocabulary identity. Cutting a new generation is the settled
  half; the open half is what a vocabulary revision should do to existing songs.
  Re-matching without a new model call is currently impossible — only the
  approved names that matched are persisted, and `unmatched_tags` counts raw output without
  linking it to a song — so the questions are which songs a `vocabulary_version`
  change re-opens, and whether that resets the per-rank attempt budget the way a
  rank increase does.

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
- **Issue:** `enrichment_recipes.enrichment_rank` is authoritative. The
  catalog contains only OpenAI recipes — three current vocabulary-v2 rows plus
  the retired vocabulary-v1 generation — whose within-provider
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

- **In plain terms:** 20 songs per model call, `low` reasoning effort, and 500
  songs per button run are educated guesses. Jobs now survive a pause safely,
  but users still need to continue large runs manually and the accuracy/cost
  tradeoff is unknown.
- **Complexity:** High — requires the eval harness before tuning is defensible.
- **Issue:** batch size and reasoning effort are now `enrichment_recipes`
  columns (`batch_size` 20, `reasoning_effort` `low`) rather than environment
  variables, and `ENRICHMENT_MAX_SONGS_PER_RUN` defaults to 500. Moving the
  first two onto the recipe made them tunable per generation without a deploy
  and recorded them against the attempts they shaped — but recording a guess
  does not measure it. Nothing has established whether smaller batches improve
  recognition/tag quality enough to justify more calls, what a higher effort
  buys, or whether the run cap is the right spending brake.
- **Why fix:** benchmark batch sizes, models, and reasoning efforts on the same
  holdout corpus, then mint recipes at the settings that win. With evidence,
  consider auto-continuing behind a spend ceiling and pausing on quality/cost
  signals rather than a raw song count alone.

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
