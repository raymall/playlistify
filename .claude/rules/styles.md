---
paths:
  - '**/*.{scss,css}'
---

# Styling (SCSS + Tailwind)

## Which tool

- Tailwind for layout, spacing, and one-off utilities.
- SCSS for complex component styling, theming, animations, and `data-*` attribute styling.
- No CSS Modules, no styled-components.

## Class & attribute naming

- Classes: `kebab-case`, BEM (`block__element--modifier`).
- `js-*` classes are JS hooks only — never styled.
- JS-driven state lives in `data-*` attributes (`data-state`, `data-kind`, `data-invalid`), styled via attribute selectors — never modifier classes.
- IDs: `kebab-case`, for accessibility relationships only (`aria-labelledby`, label wiring) — never styled, never queried from JS.
- `data-*` value casing mirrors its consumer: `camelCase` when read as TS option keys (`data-arg="narrowWidth"`), CSS-form when naming properties (`data-decl="font-size"`).
- Raw HTML attributes: double-quoted. (JSX attributes use single quotes — see `react.md`.)

## SCSS architecture

- Modern module system: `@use` / `@forward`. Never `@import`.
- Partials with a leading underscore (`_variables.scss`), under `styles/`.
- Max nesting depth: 3.
- Variables via CSS custom properties (`--var`), not SCSS `$` variables.
- Mixins / placeholders / functions: no fixed conventions.

## Property order

- Group by concern (positioning → box model → typography → visual → misc), per `stylelint-config-recess-order`.

## Units & values

- Spacing/sizing in `rem`.
- Colors: any format allowed (hex / rgb / hsl / oklch).
- `!important`: discouraged.

## Responsive

- Mobile-first (`min-width`).
- Breakpoints via both SCSS mixins and Tailwind's breakpoints.
- Nest media queries inside the selector.

## Tailwind

- Tailwind v4 (CSS-first): theme customization via `@theme` in `app/globals.css`, no `tailwind.config.js`.
- Class ordering auto-sorted via `prettier-plugin-tailwindcss`.
- Conditional/variant classes via `cn` (clsx + tailwind-merge) and `cva`. Plain `clsx` is fine for non-Tailwind class logic.
- No rules on `@apply`, arbitrary values, or theme extension.

## Formatting

- Indent with 2 spaces.
- Single quotes in SCSS.
- Lint styles with `npm run lint:css` (stylelint — recess-order + standard-scss).

## Misc

- Prefer logical properties (`margin-inline`, `padding-block`) over physical.
- Global styles / tokens in `app/globals.css`.
