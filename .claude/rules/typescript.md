---
paths:
  - '**/*.{ts,tsx,js,jsx}'
---

# TypeScript / JavaScript

## Formatting

- Indent with 2 spaces.
- Single quotes for strings.
- No semicolons.
- Trailing commas everywhere (`all`).
- Line length: Prettier default (80).
- Always use `===` / `!==`, never `==` / `!=`.

## Types

- Use `type`, not `interface`, for object shapes.
- No prefixes on type names. Use these suffixes where they apply: `Props`, `Options`, `Config`, `Params`, `Payload`, `Response`.
- No TS `enum`s — use bare union string literals (`type Status = 'active' | 'inactive'`). Handle runtime iteration case by case.
- Enforce type-only imports (`consistent-type-imports`); use the inline form (`import { type Foo, bar } from '...'`).
- Ban `any`; prefer `unknown`.
- Ban the non-null assertion (`foo!`).
- Avoid type assertions (`as` casts) — prefer proper typing and narrowing. `as const` is allowed (const assertion, not a type cast).
- Return types: not required — rely on inference.

## Functions & exports

- Top-level functions as arrow consts (`const fn = () => {}`).
- Named exports everywhere, except where Next.js requires a default export (pages, layouts, route handlers, etc.).
- Avoid barrel `index.ts` re-exports, except at an explicit module/package public-API boundary.

## Imports

- Group: side-effect imports → `node:` builtins → external packages → internal alias (`@/…`) → relative. Blank line between groups; alphabetize within each group.
- Single path alias: `@/*` → `./*` (project root; avoid `../../../`).

## Naming

- Variables & functions: `camelCase`.
- Booleans: prefix with `is` / `has` / `should` / `can` / `did` / `will`.
- Module-level constants: `UPPER_SNAKE_CASE`.
- Types, classes, enums: `PascalCase`.
- Object/type property names: no casing rule — mirror the external shape (DB columns, API fields, CSS vars).
- File-name casing: not enforced — kebab-case is the common default, PascalCase is fine for component files.

## Async

- Prefer `async/await` over `.then()` chains.

## Backend (Node/Express)

- ESM (`import`), not CommonJS. Otherwise inherit the rules above.

## Comments

- JSDoc/comments only when the code isn't self-explanatory.
