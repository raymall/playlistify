# Project plan

`MVP-PLAN.md` is the source of truth for scope, stack, and the MVP build order. Read it before starting feature work.

# Product reasoning

`HOW-IT-WORKS.md` explains, in plain language, what the product does and why it decides what it decides — enrichment, the Accuracy bands, when a song may be re-analyzed, and how a chat request becomes a playlist. Read it before changing any of that behaviour; keep it free of implementation detail.

# Codebase map

`ARCHITECTURE.md` is the wayfinding index — directory map, route inventory, core flows, and where new code goes. Read it **before** searching the codebase for where something lives; it names the exact files.

Keeping it current is part of every change: any change that adds, moves, renames, or removes files, routes, tables, or env vars must update `ARCHITECTURE.md` in the same commit.

# Coding rules

Path-scoped rule files live in `.claude/rules/` and auto-load each session.

When a file matches multiple rule files, follow all of them; more specific rules win on conflict. Match existing patterns in a file or project over these defaults when they diverge.

# Database changes

The DB is a linked remote Supabase project; `supabase/migrations/` is the source of truth. Any schema change must run the **full sequence** — skipping a step desyncs the repo, the remote, and the generated types. See `.claude/rules/database.md` for the detail and the RLS rules. In short:

1. Add a migration file (`npx supabase migration new <name>`) with RLS enabled + policies on any new table.
2. Apply it: `npx supabase db push`.
3. Regenerate types: `npm run gen:types` (wraps `supabase gen types` + lint header + prettier — don't run the bare command).
4. Run advisors (MCP `get_advisors`, `security` + `performance`) and fix findings.
5. Run `npm run verify:rls` (always) plus any other `verify:*` script the change touches, then `npm run typecheck`.
6. Commit the migration and regenerated `types.ts` together.

# Improvements log

`IMPROVEMENTS.md` (root, gitignored) is the running log of technical debt, sharp edges, deferred work, suggestions, and ideas. Whenever any of those surface during a session — something you noticed, worked around, deferred, or would recommend — record it there **in the same session**, don't just mention it in chat.

- Follow the file's entry format: `## <Title>` + `**Issue:**` / `**Why fix:**` bullets.
- Active sharp edges go in the top section; nice-to-haves and deferred work go under `# Deferred`.
- Before adding, check for an existing entry covering the same item — update it instead of duplicating; delete entries that get resolved.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
