---
paths:
  - 'supabase/**'
  - 'lib/supabase/**'
  - 'scripts/**'
---

# Database (Supabase)

The database is a **linked remote Supabase project** (ref lives in
`supabase/.temp/project-ref`, gitignored). `.env.local` points the app **and**
the verify scripts at that remote — there is no local stack; all work goes
straight to the remote. `supabase/migrations/` is the **source of truth** for the schema;
`lib/supabase/types.ts` is generated from it. The CLI is not installed
globally — always call it via `npx supabase`, which resolves the exact version
pinned in `devDependencies`. Never install it globally or let it float: an
upstream release shipping no binary for the current platform would otherwise
break every step below at once.

## Every schema change runs this full sequence

Skipping a step leaves the repo, the remote, and the types out of sync. Do all
of it, in order:

1. **Author a migration file.** `npx supabase migration new <name>` scaffolds
   `supabase/migrations/<timestamp>_<name>.sql`; write the DDL there. Never
   hand-edit a migration that has already been applied — add a new one.
2. **Satisfy the RLS invariant** in the same migration (see below). A new
   `public` table with no `enable row level security` + policies is a bug.
3. **Apply it to the remote:** `npx supabase db push`. Prefer this so the file
   and the remote migration history stay in lockstep.
4. **Regenerate types** into the checked-in file: `npm run gen:types`. It wraps
   `npx supabase gen types typescript --linked --schema public`, re-prepends the
   `/* eslint-disable */` header, and formats with prettier — raw gen output
   fails lint and includes a `graphql_public` section the committed file doesn't
   have, so never run the bare command. Never hand-edit that file.
5. **Run the advisors** (MCP `get_advisors`) for **both** `security` and
   `performance`; fix what they flag — RLS gaps, missing FK indexes,
   security-definer views. Do this after every schema change.
6. **Run the verify scripts** that cover the change (all hit the remote via
   `.env.local`):
   - `npm run verify:rls` — **always** after schema/RLS changes. Proves a
     signed-out (anon) client sees zero rows on every table.
   - `npm run verify:import` — import pipeline changes.
   - `npm run verify:enrichment` — enrichment pipeline changes.
   - `npm run verify:re-enrichment` — recipe, job, attempt, or promotion
     changes (policy cases plus remote queue invariants).
   - `npm run verify:recipes` — recipe or approved-vocabulary changes: the
     catalog matches `recipes/definitions.ts`, every stored content hash
     recomputes, and the live approved lists are checked against the newest
     frozen snapshot.
   - `npm run verify:genres` — genre/mood vocabulary (`lib/vocabulary.ts`)
     changes: approved-list reachability, the AI-link approval gate, and the
     free-form personal-tag path.
   - `npm run verify:refresh` — `spotify_tokens` or token-refresh flow changes.
7. **`npm run typecheck`** — regenerated types often surface code the new schema
   broke. Fix before committing.
8. **Commit the migration file and the regenerated `types.ts` together**, as
   one change.

## Recipe rows are authored, not migrated

`enrichment_recipes` and `vocabulary_snapshots` hold operational data minted by
`npm run recipe:sync` from `recipes/definitions.ts` — **never** seed, update, or
delete them from a migration, and never edit them in Studio. A trigger rejects
any update outside `label` / `enabled` / `is_default`, and a unique
`content_hash` makes a changed method a new row rather than an edited one, so a
seed migration would either fail or fork the catalog.

Approving `genres` / `moods` rows is still migration work. Carrying that
approval into the running recipes is a `recipe:sync` afterwards — until then the
frozen snapshots keep the old lists, and `verify:recipes` reports the drift. The
full runbook is **Recipe changes** in `AGENTS.md`.

## CLI ↔ MCP mapping

The Supabase MCP acts on the same linked remote. Use whichever, but the
migration **file** in the repo is still the source of truth.

- `apply_migration` (MCP) — applies DDL and records it in the remote history,
  but does **not** write a file into `supabase/migrations/`. If you use it, add
  and commit the identical SQL as a migration file so the repo doesn't drift.
- `execute_sql` (MCP) — raw, unversioned SQL. For read-only inspection and
  one-off data fixes only. **Never** use it for schema/DDL — it causes drift.
- `list_tables` / `list_migrations` (MCP) — inspect current structure and
  applied history before making changes.
- `generate_typescript_types` (MCP) — raw equivalent of the gen CLI call only;
  it skips the header + prettier steps, so prefer `npm run gen:types` (step 4).
- `get_advisors` (MCP) — step 5.

## RLS invariant (non-negotiable)

`verify:rls` enforces it and it is the whole security model — match the
patterns already in `20260721120000_init.sql`:

- Enable RLS on **every** new `public` table:
  `alter table public.<t> enable row level security;`
- Always wrap the auth call as `(select auth.uid())`, not bare `auth.uid()`
  (initplan caching — the performance advisor flags the bare form).
- Per-user tables: `using (user_id = (select auth.uid())) with check (…)`.
- Shared cache/vocabulary tables (`songs`, `genres`, `moods`, link tables):
  `select`/`insert` to `authenticated`, writes otherwise via the service role.
- Service-role-only tables (`spotify_tokens`): RLS enabled, **zero** policies.
- Index every foreign key and the columns policies filter on.
