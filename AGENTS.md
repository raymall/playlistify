# Project plan

`MVP-PLAN.md` is the source of truth for scope, stack, and the MVP build order. Read it before starting feature work.

# Coding rules

Path-scoped rule files live in `.claude/rules/` and auto-load each session.

- `typescript.md` — TS/JS — applies to `**/*.{ts,tsx,js,jsx}`
- `react.md` — React + Next.js (App Router) — applies to `**/*.{tsx,jsx}`
- `styles.md` — SCSS + Tailwind — applies to `**/*.{scss,css}`
- `browser.md` — Vanilla browser JS — applies to `public/**/*.js`
- `accessibility.md` — WCAG conformance (2.2, Level AA minimum) — applies to `**/*.{tsx,jsx,html,liquid,css,scss}`, `public/**/*.js`
- `database.md` — Supabase schema/RLS/migration workflow — applies to `supabase/**`, `lib/supabase/**`, `scripts/**`
- `commits.md` — Commit message format — always applies
- `pull-requests.md` — PR format — always applies

When a file matches multiple rule files, follow all of them; more specific rules win on conflict. Match existing patterns in a file or project over these defaults when they diverge.

# Database changes

The DB is a linked remote Supabase project; `supabase/migrations/` is the source of truth. Any schema change must run the **full sequence** — skipping a step desyncs the repo, the remote, and the generated types. See `.claude/rules/database.md` for the detail and the RLS rules. In short:

1. Add a migration file (`npx supabase migration new <name>`) with RLS enabled + policies on any new table.
2. Apply it: `npx supabase db push`.
3. Regenerate types: `npm run gen:types` (wraps `supabase gen types` + lint header + prettier — don't run the bare command).
4. Run advisors (MCP `get_advisors`, `security` + `performance`) and fix findings.
5. Run `npm run verify:rls` (always) plus any other `verify:*` script the change touches, then `npm run typecheck`.
6. Commit the migration and regenerated `types.ts` together.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
