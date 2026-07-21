---
paths:
  - 'public/**/*.js'
---

# Vanilla browser JS

For standalone, non-Next.js pages served from `public/` (specific HTML pages and their scripts).
Also follows `typescript.md`; the rules below override it where they differ.

- Authored as `.js` directly, no build step. No frameworks.
- Classic scripts (IIFE pattern, no ES `import`/`export`) — overrides the ESM rule for this path.
- Load with the `defer` attribute; no `DOMContentLoaded` wrapper needed.
- Target: evergreen browsers, last 2 versions.
- Selection contract: query via `js-*` hook classes (`querySelector('.js-toggle')`); read/write state via `data-*` attributes (same contract as the CSS side).
- Guard `querySelector` / `getElementById` results (early-return on null); never non-null-assert.
- Events: `addEventListener` only (no inline `on*` attributes). Prefer event delegation where sensible.
- Small utility libraries allowed.
