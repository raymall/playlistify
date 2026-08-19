# Project plan

`MVP-PLAN.md` is the source of truth for scope, stack, and the MVP build order. Read it before starting feature work.

# Product reasoning

`HOW-IT-WORKS.md` explains, in plain language, what the product does and why it decides what it decides — enrichment, the Accuracy bands, when a song may be re-analyzed, and how a chat request becomes a playlist. Read it before changing any of that behaviour; keep it free of implementation detail.

# Codebase map

`ARCHITECTURE.md` is the wayfinding index — directory map, route inventory, core flows, and where new code goes. Read it **before** searching the codebase for where something lives; it names the exact files.

Keeping it current is part of every change: any change that adds, moves, renames, or removes files, routes, tables, or env vars must update `ARCHITECTURE.md` in the same commit.

# Coding rules

Detailed coding rules are shared by Claude Code and Codex in `.claude/rules/`.
Claude Code applies their `paths` frontmatter automatically. Codex does not, so
before editing or reviewing a matching file, read every applicable rule file:

| Files or task                                  | Required rules                                               |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `**/*.{ts,tsx,js,jsx}`                         | `.claude/rules/typescript.md`                                |
| `**/*.{tsx,jsx}`                               | `.claude/rules/react.md`, `.claude/rules/accessibility.md`   |
| `**/*.{css,scss}`                              | `.claude/rules/styles.md`, `.claude/rules/accessibility.md`  |
| `**/*.{html,liquid}`                           | `.claude/rules/accessibility.md`                             |
| `public/**/*.js`                               | `.claude/rules/browser.md`, `.claude/rules/accessibility.md` |
| `supabase/**`, `lib/supabase/**`, `scripts/**` | `.claude/rules/database.md`                                  |
| Branching or creating a commit                 | `.claude/rules/commits.md`                                   |
| Creating a pull request                        | `.claude/rules/pull-requests.md`                             |
| Verifying anything in a browser                | `.claude/rules/verification.md`                              |

When a file matches multiple rule files, follow all of them; more specific rules win on conflict. Match existing patterns in a file or project over these defaults when they diverge.

# Database changes

The DB is a linked remote Supabase project; `supabase/migrations/` is the source of truth. Any schema change must run the **full sequence** — skipping a step desyncs the repo, the remote, and the generated types. See `.claude/rules/database.md` for the detail and the RLS rules. In short:

1. Add a migration file (`npx supabase migration new <name>`) with RLS enabled + policies on any new table.
2. Apply it: `npx supabase db push`.
3. Regenerate types: `npm run gen:types` (wraps `supabase gen types` + lint header + prettier — don't run the bare command).
4. Run advisors (MCP `get_advisors`, `security` + `performance`) and fix findings.
5. Run `npm run verify:rls` (always) plus any other `verify:*` script the change touches, then `npm run typecheck`.
6. Commit the migration and regenerated `types.ts` together.

# Recipe changes

A recipe is the **complete method** behind one analysis — model, reasoning effort, batch size, rank, prompt text, identity fields, output caps, and a frozen copy of the approved vocabulary. All of it is stored on the `enrichment_recipes` row and covered by a unique `content_hash`, so changing any of it **mints a new recipe instead of editing the old one**. That is a database guarantee (unique index + immutability trigger), not a convention — which is what keeps every past attempt's identity true.

`recipes/definitions.ts` and `recipes/prompts/*.md` are the authored source; `npm run recipe:sync` turns them into rows. Never edit an `enrichment_recipes` or `vocabulary_snapshots` row in Studio, and never seed one from a migration.

1. Edit `recipes/definitions.ts` (model, effort, batch size, rank, output spec, flags) or the prompt file in `recipes/prompts/`.
2. Dry run: `npm run recipe:sync` — prints the full plan and writes nothing. Read what it says it will mint before going on.
3. Apply: `npm run recipe:sync -- --yes`.
4. Verify: `npm run verify:recipes`, plus `npm run verify:re-enrichment` when ranks or flags moved.
5. `npm run typecheck`, then commit the definition/prompt change.

Only `label`, `enabled`, and `is_default` are mutable — changing those relabels or reactivates existing rows and mints nothing. Everything else is in the hash.

**Approving a genre or mood is two steps.** The approval itself is a migration (see **Database changes**); it reaches running analyses only when a later `recipe:sync` mints recipes that freeze the new list. `verify:recipes` reports the drift in between, so a pending mint is visible rather than silent.

**Rank is a human decision the sync never guesses.** Keep ranks stable across a mint unless re-opening songs is the intent: a new recipe at the same rank grants no fresh attempts, while a higher rank re-opens finished songs and bills a full re-analysis. Do not enable two recipes at the same rank — the sync warns, and the tiebreak between them is a hash.

# Improvements log

`IMPROVEMENTS.md` (root, committed) is the running log of technical debt, sharp edges, deferred work, suggestions, and ideas. Whenever any of those surface during a session — something you noticed, worked around, deferred, or would recommend — record it there **in the same session**, don't just mention it in chat.

- Follow the file's entry format: `## <Title>` + `**Issue:**` / `**Why fix:**` bullets.
- Active sharp edges go in the top section; nice-to-haves and deferred work go under `# Deferred`.
- Before adding, check for an existing entry covering the same item — update it instead of duplicating; delete entries that get resolved.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
