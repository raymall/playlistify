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
globally — always call it via `npx supabase`.

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
4. **Regenerate types** into the checked-in file:
   `npx supabase gen types typescript --linked > lib/supabase/types.ts`
   (`--project-id <ref>` also works). Never hand-edit that file.
5. **Run the advisors** (MCP `get_advisors`) for **both** `security` and
   `performance`; fix what they flag — RLS gaps, missing FK indexes,
   security-definer views. Do this after every schema change.
6. **Run the verify scripts** that cover the change (all hit the remote via
   `.env.local`):
   - `npm run verify:rls` — **always** after schema/RLS changes. Proves a
     signed-out (anon) client sees zero rows on every table.
   - `npm run verify:import` — import/enrichment pipeline changes.
   - `npm run verify:tokens` — `spotify_tokens` changes.
   - `npm run verify:refresh` — token-refresh flow changes.
7. **`npm run typecheck`** — regenerated types often surface code the new schema
   broke. Fix before committing.
8. **Commit the migration file and the regenerated `types.ts` together**, as
   one change.

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
- `generate_typescript_types` (MCP) — equivalent to step 4.
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
