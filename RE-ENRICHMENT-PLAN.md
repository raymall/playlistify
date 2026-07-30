# Global re-enrichment implementation plan

Status: implemented in the application and linked Supabase project on
2026-07-29. Production code deployment and a billable canary remain release
operations; they were intentionally not triggered by the implementation work.

This plan is now also the design and rollout record for the guarded
candidate-and-promotion workflow. `HOW-IT-WORKS.md` describes the user-visible
behavior and `ARCHITECTURE.md` maps the implementation.

## Product decision

Every recording has one canonical enrichment shared by all users. Re-analysis
may improve that shared record, but a model response does not become canonical
merely because it came from a stronger model.

The target has three independent layers:

| Layer                | Purpose                                                                        | Mutability                         |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| Canonical enrichment | The accepted AI genres, moods, attributes, and recognition state used globally | Replaced only by guarded promotion |
| Enrichment attempts  | Immutable candidates and unsuccessful attempts                                 | Append-only                        |
| Personal overlay     | A user's added tags and suppressed AI tags                                     | Immediately editable by that user  |

For a user, effective tags are:

`(canonical AI tags - that user's suppressions) + that user's tags`

Personal data never writes directly into the canonical record. Repeated
personal tags, suppressions, or future reports may become review signals, but
never automatic global truth.

## Goals

- Preserve one globally shared enrichment per recording.
- Allow `None` and `Low` songs to improve when a genuinely stronger analysis
  recipe becomes available.
- Guarantee that a retry cannot turn a usable global result into a worse one.
- Replace the complete AI tag snapshot on promotion; never accumulate stale
  tags from earlier analyses.
- Prevent duplicate billing when several users encounter or request the same
  song.
- Resolve concurrent enrichments without last-write-wins races.
- Let a user correct their own playlist experience immediately without changing
  what other users see.
- Keep the consumer UX about song readiness, not model vendors or rank numbers.
- Preserve the current client-driven batch execution and spending caps for the
  first release; a scheduled worker is not required for correctness.

## Non-goals

- Re-analyzing `Medium` or `High` songs through the normal user flow.
- Automatically converting personal tags or suppressions into global tags.
- Web-search or third-party catalog fallback.
- An admin dashboard for recipes, attempts, or the queue.
- A user-facing “Report incorrect analysis” workflow. That is deferred in
  `IMPROVEMENTS.md`.
- A full calibration or evaluation platform. The existing model-rank policy is
  retained initially; the planned enrichment-evals workstream remains the path
  to evidence-based cross-provider recipe ranks.
- A scheduled background worker. Queued work is drained by the existing
  authenticated, client-driven enrichment loop in this iteration.

## Invariants

These rules are load-bearing and must be enforced in the database transaction
that promotes a candidate, not only in client code:

1. There is at most one canonical enrichment for a song.
2. Every billable per-song outcome is represented by an immutable attempt.
3. The same song and recipe cannot have more than one active job.
4. A recipe may retry a song only when its rank strictly exceeds the highest
   recipe rank already attempted for that song.
5. `Medium` and `High` canonical results are not eligible for normal
   re-analysis.
6. `Low` may only be replaced by a recognized result in a strictly better
   Accuracy band.
7. `Low` may never be replaced by `None`.
8. `None` may be replaced by any recognized result that passes the existing
   recognition threshold and vocabulary validation.
9. A promoted recognized result atomically replaces AI attributes, AI genres,
   and AI moods as one snapshot.
10. A rejected, omitted, failed, or stale candidate cannot change canonical
    data.
11. A stale promotion is re-evaluated against the latest canonical revision
    while the song row is locked.
12. Personal additions and suppressions affect only their owner.

## Terminology

- **Canonical result:** the global result currently used by library views and
  playlist search.
- **Candidate:** a validated structured model response that has not been
  promoted.
- **Attempt:** the immutable record of one song's outcome in a billable batch,
  including recognized, unknown, omitted, and failed outcomes.
- **Recipe:** the complete analysis configuration: model, prompt version,
  vocabulary version, identity-input version, and rank.
- **Job:** a deduplicated request to run one recipe against one song.
- **Promotion:** the atomic transaction that accepts a candidate as the new
  canonical result.
- **Suppression:** a private instruction to ignore one canonical AI tag for one
  user.

## Target data model

Names below are the intended implementation names. The migration remains the
schema source of truth.

### `enrichment_recipes`

An operational catalog separate from `llm_models`. A model is only one part of
an analysis recipe.

| Column               | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `id`                 | UUID primary key                                               |
| `model_id`           | Foreign key to `llm_models`                                    |
| `recipe_key`         | Stable unique identifier used for deduplication                |
| `label`              | Owner-facing label                                             |
| `prompt_version`     | Explicit prompt revision                                       |
| `vocabulary_version` | Approved-vocabulary revision used by the prompt and matcher    |
| `identity_version`   | Revision of the metadata supplied for recording identification |
| `enrichment_rank`    | Sparse, evidence-backed capability ordering                    |
| `enabled`            | Whether new jobs may use the recipe                            |
| `is_default`         | The system-selected recipe for first-pass enrichment           |
| `created_at`         | Audit timestamp                                                |

`enrichment_recipes.enrichment_rank` becomes authoritative. Keep
`llm_models.enrichment_rank` during the rollout for compatibility, then remove
or clearly deprecate it in a later migration after no callers remain.

Seed one recipe for each model configuration that existing rows may reference.
The seed must preserve today's effective ranks. Changing a prompt, vocabulary,
or identity strategy creates a new recipe row; it never mutates the identity of
an old recipe.

### `song_enrichment_attempts`

Append-only evidence and audit history.

| Column                       | Purpose                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                         | UUID primary key                                                                               |
| `song_id`                    | Global song                                                                                    |
| `recipe_id`                  | Recipe used                                                                                    |
| `recipe_rank`                | Immutable rank snapshot                                                                        |
| `provider` / `model_id`      | Immutable provider/model snapshots                                                             |
| `outcome`                    | `recognized`, `unknown`, `omitted`, or `failed`                                                |
| `confidence`                 | Rounded recognition confidence, nullable for no structured response                            |
| `ai_attributes`              | Candidate attributes, nullable                                                                 |
| `genre_names` / `mood_names` | Normalized approved candidate names                                                            |
| `expected_revision`          | Canonical song revision observed when work was claimed                                         |
| `decision`                   | `pending`, `promoted`, or `rejected`                                                           |
| `decision_reason`            | Stable reason code such as `improved_band`, `not_better`, `superseded`, or `invalid_candidate` |
| `created_at` / `decided_at`  | Audit timestamps                                                                               |

The table is service-role-only: RLS enabled with no client policies. Attempts
are never edited except for the one-way decision transition from `pending` to
`promoted` or `rejected`.

### `song_enrichment_jobs`

A global, deduplicated work queue.

| Column                             | Purpose                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `id`                               | UUID primary key                                                |
| `song_id` / `recipe_id`            | Unique work identity                                            |
| `status`                           | `queued`, `leased`, `completed`, or `failed`                    |
| `priority`                         | Pending/weak state, explicit recheck demand, reach, and recency |
| `request_count`                    | Number of coalesced user requests                               |
| `attempt_count`                    | Omission/failure retry counter                                  |
| `next_attempt_at`                  | Backoff/cooldown                                                |
| `lease_token` / `lease_expires_at` | Crash-safe claim                                                |
| `result_attempt_id`                | Attempt that completed the job, when present                    |
| `created_at` / `updated_at`        | Queue timestamps                                                |

Use a unique constraint on `(song_id, recipe_id)`. Re-requesting the same work
increments demand or returns the existing state; it never inserts another
billable job.

The queue is service-role-only. The API proves the caller owns the song through
`user_songs` before it enqueues or exposes a song-specific job state.

### `songs` additions

Keep the current canonical enrichment columns for fast reads. Add:

| Column                          | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `active_enrichment_attempt_id`  | Candidate that produced the canonical result; nullable for legacy rows |
| `enrichment_revision`           | Monotonic compare-and-swap revision                                    |
| `highest_attempted_recipe_id`   | Highest-ranked attempted recipe snapshot                               |
| `highest_attempted_recipe_rank` | Fast eligibility filter independent of the active result               |

Backfill `highest_attempted_recipe_rank` from the current `enrichment_rank`.
Existing canonical rows do not need synthetic attempt history:
`active_enrichment_attempt_id = null` explicitly means “legacy canonical
result.” The first successful promotion starts the pointer-based history.

Separating active rank from highest-attempted rank is essential. If a stronger
recipe turns a `Low` song into `None`, the candidate is rejected, but that
recipe must still be remembered so it is not billed again.

### Personal suppressions

Add `user_genre_suppressions` and `user_mood_suppressions`, each containing:

- `user_id`
- `song_id`
- `genre_id` or `mood_id`
- `created_at`

Use the same ownership and RLS pattern as the existing personal-tag tables.
Index every foreign key and policy column. A suppression remains harmless if a
later canonical result no longer carries that tag; if the tag returns, the
user's preference remains effective until they undo it.

## Recipe and eligibility policy

The server selects recipes. The public API never accepts a provider, model
string, recipe rank, or prompt version supplied by the browser.

### First-pass analysis

- Use the enabled default recipe.
- Create or reuse a `(song, recipe)` job.
- Pending work remains higher priority than weak-result retries during an
  active user's initial library run.
- A valid recognized result becomes canonical.
- An honest unknown result becomes the canonical `None` state.
- Omitted songs follow the existing three-attempt cap before that recipe is set
  aside.

### Re-analysis

- Only `None` and `Low` are eligible.
- Choose the lowest-rank enabled recipe that strictly outranks
  `highest_attempted_recipe_rank`; recipe selection is deterministic.
- If no stronger recipe exists, return `no_better_recipe` without enqueueing or
  billing.
- One explicit user recheck raises priority but does not bypass eligibility,
  attempt caps, cooldowns, or promotion rules.
- Further clicks coalesce into the existing job.
- A new recipe starts with a fresh omission allowance.

### Promotion matrix

| Current canonical | Candidate                                | Decision                                                  |
| ----------------- | ---------------------------------------- | --------------------------------------------------------- |
| Pending           | Recognized                               | Promote                                                   |
| Pending           | Unknown                                  | Promote as `None`                                         |
| None              | Recognized at any valid band             | Promote                                                   |
| None              | Unknown                                  | Reject as no improvement; retain canonical state          |
| Low               | Medium or High                           | Promote                                                   |
| Low               | Low or Unknown                           | Reject; retain the current Low result and tags            |
| Medium or High    | Any normal candidate                     | Reject as ineligible                                      |
| Any               | Invalid, failed, or omitted              | Reject/no canonical write                                 |
| Any               | Superseded by a newer canonical revision | Re-evaluate under lock; promote only if it still improves |

The first implementation deliberately compares bands rather than raw confidence
across recipes. A model's self-reported `0.70` is not proven commensurate with
another model's `0.65`. Finer-grained promotion belongs after confidence
calibration exists.

## Atomic promotion

Add one database function, called only by the service-role path, that performs
promotion in a transaction:

1. Lock the attempt and song rows.
2. Confirm the attempt is undecided and load the latest canonical revision.
3. Recompute the eligibility and promotion matrix against the current row.
4. Update `highest_attempted_recipe_*` with `greatest(current, candidate)` even
   when the candidate is rejected.
5. For a promoted recognized candidate:
   - resolve approved tag IDs;
   - delete all existing `song_genres` and `song_moods` links;
   - insert the candidate's complete genre and mood link sets;
   - replace confidence, attributes, status, recipe/model snapshots, and
     `enriched_at`;
   - point `active_enrichment_attempt_id` at the candidate;
   - increment `enrichment_revision`.
6. For a first-pass unknown promotion, clear global AI links and attributes,
   write `unknown`, point at the attempt, and increment the revision.
7. Mark the attempt `promoted` or `rejected` with a reason.
8. Complete the queue job.

Any failure rolls back the entire promotion. There must be no state where a
song exposes new attributes with old tags, new tags with an old status, or a
partially replaced tag snapshot.

## Queue execution and cost controls

The first release keeps the existing client-driven loop:

1. Import or a user action creates/reuses eligible jobs.
2. `POST /api/enrich` claims a lease on a batch of jobs for songs in the
   caller's library.
3. All jobs in one structured-output call use the same recipe.
4. The engine writes attempts, invokes atomic promotion, and completes or
   reschedules each job.
5. The client continues until its library has no eligible jobs or the existing
   per-run cap is reached.

Claim jobs with `FOR UPDATE SKIP LOCKED` semantics in a database function so
overlapping users cannot process the same work. Expired leases return to the
queue. A lease token must be presented when completing a job so a timed-out
worker cannot commit stale ownership. The caller chooses that token before the
claim: if the database commits but the HTTP response is lost, retrying with the
same token returns the original leased batch instead of reserving another.

Priority order for a caller's library:

1. Never-analyzed songs needed for the caller's initial usable library.
2. Explicitly requested `None` songs.
3. Explicitly requested `Low` songs.
4. Other eligible `None` songs.
5. Other eligible `Low` songs.

Within a class, prioritize the number of distinct libraries containing the song
and then recent user activity. Reach is a prioritization signal only; it does
not affect promotion.

Retain:

- Batch-size and per-run caps.
- Safe-to-retry versus already-billed failure lanes.
- Three-strike omission handling per recipe.
- Exponential retry backoff.
- Server-side recipe validation.

## Personal-overlay behavior

Library and chat reads must use the same effective-tag rule.

For each tag kind:

1. Start with canonical AI links.
2. Remove links suppressed by the current user for that song.
3. Union the user's personal links.

If a user personally adds the same tag they previously suppressed, the personal
addition wins. Removing the personal addition reveals the still-suppressed AI
tag only after the user also undoes the suppression.

Update both `library_tag_names()` and `library_selectable_songs()` so the chat
prompt and candidate search cannot drift from the library UI. Add verification
coverage for:

- User A suppresses an AI tag; it disappears only for A.
- User B still sees and searches the global tag.
- A personal tag with the same name still matches for A.
- A `None` song becomes selectable through personal tags, with the existing
  limitation that missing AI energy/era/tempo cannot satisfy those filters.

## UX specification

### Language

Call the user-facing column `Confidence`. Self-reported model confidence is not
measured accuracy, but the five bands remain useful when that distinction is
stated explicitly.

| Confidence band | Meaning                                                       |
| --------------- | ------------------------------------------------------------- |
| Pending         | No canonical attempt has completed                            |
| None            | No trustworthy global tags were produced                      |
| Low             | Recognized weakly; global tags do not drive playlist matching |
| Medium          | Usable model-reported confidence                              |
| High            | Strong model-reported confidence                              |

Do not ask users to interpret model confidence as correctness.

### Library summary

Replace model-centric progress with confidence-band counts:

- Pending
- None
- Low
- Medium
- High

The primary action is `Analyze & improve`, with progress and the number of
eligible songs. The server chooses the recipe. Remove the end-user model
selector after the new recipe path is proven; model and recipe controls remain
owner-operated through Supabase.

### Per-song controls

AI and personal chips remain visually distinguishable:

- AI chip action: `Hide for me`
- Personal chip action: `Remove`
- Suppression-management action: `Show hidden tags`, with undo
- `None` or `Low` action: `Request recheck`

`Request recheck` states:

- **Available:** a stronger recipe exists.
- **Queued:** a global job already exists; repeated clicks do not duplicate it.
- **Analyzing:** the job is leased.
- **No higher confidence yet:** no stronger enabled recipe exists.
- **Checked, not improved:** a stronger recipe ran but failed the promotion
  gate.
- **Improved:** canonical result was promoted; refresh the row and announce the
  status change.

Copy should explain: “We only replace shared analysis when the new result is
better. Improvements apply everywhere this song appears.”

Do not expose ranks, provider names, retry counts, or global request counts in
the consumer UI.

### Accessibility

- All chip actions need explicit accessible names containing the tag and song.
- Queue and promotion state changes use a polite live region.
- Do not communicate AI versus personal, or queued versus improved, by color
  alone.
- Preserve keyboard access, visible focus, and minimum target sizes.
- Returning from a popover or dialog restores focus to its trigger.

## API changes

### `POST /api/enrich`

- Remove `modelId` from the eventual public request contract.
- Resolve the eligible system recipe server-side.
- Claim only jobs associated with songs in the caller's library.
- Return counts for Pending, None, Low, Medium, High, queued, and ineligible
  weak songs.
- Preserve `safeToRetry` billing semantics.

During rollout, support the old request shape only behind the old engine path.
Do not silently interpret a client model ID as a recipe.

### `POST /api/enrichment-requests`

Body: `{ songId }`.

- Require a valid user.
- Prove the song belongs to the caller.
- Accept only canonical `None` or `Low`.
- Resolve the next eligible recipe server-side.
- Create or coalesce the global job.
- Return `queued`, `already_queued`, `analyzing`,
  `already_checked`, or `no_better_recipe`.
- Rate-limit by user and song even though deduplication prevents duplicate
  billing.

This endpoint is a recheck request, not a correctness report. The deferred
reporting feature will need different reasons, moderation, and access patterns.

### `POST|DELETE /api/tags`

Keep personal additions/removals. Add explicit suppression operations rather
than overloading deletion:

- Hide one canonical AI tag for the caller.
- Undo one suppression.
- Reject suppression of a tag that is neither canonical nor associated with
  the song.

The wire contract should identify the operation unambiguously; a generic
“delete tag” must not sometimes mutate a personal link and sometimes create a
suppression.

## Implementation phases

### Phase 1 — Schema foundation

Files:

- New migration under `supabase/migrations/`
- Generated `lib/supabase/types.ts`
- `ARCHITECTURE.md`

Work:

- Create recipes, attempts, jobs, and both suppression tables.
- Add song revision and highest-attempted columns.
- Seed legacy/default recipes without changing current behavior.
- Add checks, unique constraints, foreign-key indexes, and RLS.
- Add the atomic promotion and lease-claim database functions.
- Backfill `highest_attempted_recipe_rank` from `songs.enrichment_rank`.
- Keep all new execution behavior disabled until Phase 2 is deployed.

Validation:

- Apply the full linked-remote migration sequence in
  `.claude/rules/database.md`.
- Run security and performance advisors.
- Run `verify:rls`, `verify:enrichment`, and `typecheck`.
- Prove anon and cross-user access cannot read attempts/jobs or another user's
  suppressions.

### Phase 2 — Candidate generation and guarded promotion

Files:

- `lib/enrichment/engine.ts`
- New focused modules under `lib/enrichment/` for recipe resolution, candidate
  normalization, and promotion contracts
- `app/api/enrich/route.ts`
- `scripts/verify-enrichment.mjs`

Work:

- Split “call the model” from “write canonical enrichment.”
- Persist per-song outcomes as attempts.
- Route every canonical mutation through the promotion function.
- Replace tags atomically on promotion.
- Record rejected and omitted attempts without changing canonical data.
- Use active versus highest-attempted rank correctly.
- Make completion idempotent under response retries.

Validation:

- Run the promotion-policy matrix as unit tests.
- Verify a stronger unknown result cannot replace Low.
- Verify a Low candidate cannot replace another Low.
- Verify promoted tags exactly equal the candidate snapshot.
- Simulate rank-200 and rank-300 runs finishing in reverse order; the weaker
  candidate must not win.
- Simulate a crash before and after promotion; retry must not duplicate billing
  or canonical links.

### Phase 3 — Queue claims and system recipe selection

Files:

- `lib/enrichment/engine.ts`
- `lib/ai/models.ts` or a new `lib/enrichment/recipes.ts`
- `app/api/enrich/route.ts`
- `components/library-enrichment-panel.tsx`
- `app/library/page.tsx`

Work:

- Enqueue/reuse jobs instead of selecting writable song rows directly.
- Claim batches with leases and deduplicate globally.
- Select recipes server-side.
- Preserve the client-driven loop, caps, retry lanes, and resumability.
- Replace model-specific counts with outcome/job counts.
- Keep the current selector temporarily behind the old path until canary
  validation passes; then remove it from the end-user panel.

Validation:

- Two users with the same pending song produce one active job and one billable
  attempt.
- An expired lease is recoverable.
- A stale lease token cannot complete a job.
- No eligible stronger recipe returns without billing.
- The run terminates when only ineligible weak songs remain.

### Phase 4 — Personal suppressions and effective-tag reads

Files:

- `lib/tags.ts`
- `app/api/tags/route.ts`
- `components/library-tag-editor.tsx`
- `lib/chat/library-search.ts`
- Migration updating `library_tag_names()` and
  `library_selectable_songs()`
- Relevant verification scripts

Work:

- Add hide/undo mutations with ownership checks.
- Show AI, personal, and hidden states without conflating their meaning.
- Apply the effective-tag formula consistently in library and chat.
- Keep personal additions as the immediate recovery path for `None` songs.

Validation:

- Cross-user isolation test with two real users.
- Chat prompt vocabulary and search results match the visible effective tags.
- Suppressing an AI tag cannot delete a global link.
- Removing a personal tag cannot create or remove a suppression accidentally.

### Phase 5 — Recheck UX

Files:

- New `/api/enrichment-requests` route
- Library row/table and enrichment-panel components
- Confidence copy modules

Work:

- Add the per-song `Request recheck` state machine.
- Add outcome-centric summary counts.
- Rename the user-facing column to Confidence while preserving all five bands.
- Refresh only after a terminal job transition; do not poll aggressively.
- Announce queued, not-improved, and improved results accessibly.
- Remove the public model selector after rollout acceptance.

Validation:

- Keyboard and screen-reader pass over every new action/state.
- Repeated requests coalesce visibly.
- No-better-recipe state does not imply an error.
- Closing the page leaves queued work safe for a later run.

### Phase 6 — Rollout and cleanup

Completed implementation/cleanup:

- Applied the additive schema to the linked Supabase project.
- Removed the old direct canonical-write path.
- Removed the end-user model selector and obsolete response states.
- Updated `HOW-IT-WORKS.md`, `ARCHITECTURE.md`, and `MVP-PLAN.md`.

Remaining release operations:

- Deploy the application code.
- Canary attempts and promotions on a small set of existing `None`/`Low` songs.
- Compare canonical tags before/after every canary promotion.
- Enable queue-based writes for one owner account.
- Expand to all users after the race, rollback, and cost checks pass.
- Deprecate `llm_models.enrichment_rank` only after every caller uses recipes.
- Remove improvements-log entries that this work resolves, with user
  confirmation as required by that file.

Rollback:

- Disable creation/claiming of new jobs.
- Keep canonical reads on the existing `songs` and link tables.
- Attempts and queued jobs may remain for audit; they are not on the read path.
- Because promotion is transactional and canonical columns remain compatible,
  rollback does not require reconstructing user-visible data.

## Test matrix

At minimum, automate these cases:

| Case                                | Expected result                       |
| ----------------------------------- | ------------------------------------- |
| Pending + recognized                | Canonical recognized snapshot         |
| Pending + unknown                   | Canonical `None`, no AI tags          |
| None + Low                          | Promote; remains Low                  |
| None + Medium/High                  | Promote; becomes Medium/High          |
| Low + Low                           | Reject; old tags/attributes unchanged |
| Low + unknown                       | Reject; old tags/attributes unchanged |
| Low + Medium/High                   | Promote and exactly replace tags      |
| Medium/High request                 | No job, no billing                    |
| Same song/recipe requested twice    | One job                               |
| Same song claimed by two workers    | One valid lease                       |
| Weaker and stronger candidates race | Stronger valid promotion remains      |
| Promotion DB error                  | Entire canonical snapshot unchanged   |
| User A hides global tag             | Hidden only for A                     |
| User A adds a hidden tag personally | Tag is effective for A                |
| User B searches same tag            | Global behavior unchanged for B       |
| Same recipe omits song three times  | Job set aside until a stronger recipe |

## Observability and success measures

Record operational metrics by recipe, never by exposing personal tags:

- Queue depth and oldest queued age.
- Jobs coalesced and duplicate billable calls avoided.
- Attempts by outcome and rejection reason.
- `None → recognized` and `Low → Medium/High` promotion rates.
- Cost and latency per attempt and per successful promotion.
- Omission and lease-expiry rates.
- Canonical rollback/transaction failures.
- Songs improved weighted by number of libraries containing them.

Product success means:

- No observed canonical downgrades.
- No stale AI tags surviving a successful promotion.
- Concurrent requests cause one billable job.
- Users can make a wrong or missing tag stop affecting their own playlists
  immediately.
- Weak-song coverage improves without reprocessing the Medium/High majority.

## Definition of done

- All six phases are shipped or explicitly descoped.
- Every canonical write uses guarded atomic promotion.
- Queue deduplication and leasing are enforced in the database.
- The public enrichment API accepts no model or rank authority from the client.
- Personal suppressions are honored consistently by Library and Chat.
- `None` and `Low` expose clear recheck states; `Medium` and `High` do not.
- The model selector is absent from the consumer UI.
- Required migration, advisor, RLS, verification, lint, typecheck, unit, and
  accessibility checks pass.
- `ARCHITECTURE.md`, `HOW-IT-WORKS.md`, and `MVP-PLAN.md` match the shipped
  behavior.
