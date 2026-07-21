# Project plan

`MVP-PLAN.md` is the source of truth for scope, stack, and the MVP build order. Read it before starting feature work.

# Coding rules

Path-scoped rule files live in `.claude/rules/` and auto-load each session.

- `typescript.md` — TS/JS — applies to `**/*.{ts,tsx,js,jsx}`
- `react.md` — React + Next.js (App Router) — applies to `**/*.{tsx,jsx}`
- `styles.md` — SCSS + Tailwind — applies to `**/*.{scss,css}`
- `browser.md` — Vanilla browser JS — applies to `public/**/*.js`
- `commits.md` — Commit message format — always applies
- `pull-requests.md` — PR format — always applies

When a file matches multiple rule files, follow all of them; more specific rules win on conflict. Match existing patterns in a file or project over these defaults when they diverge.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
