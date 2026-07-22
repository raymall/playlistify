---
paths:
  - '**/*.{tsx,jsx}'
---

# React + Next.js (App Router)

Also follows `typescript.md`.

## Components

- Define components as arrow consts.
- Named exports, except where Next.js forces a default (`page.tsx`, `layout.tsx`, route handlers, etc.).
- One primary component per file; small private sub-components may share the file.
- Component file casing: not enforced — PascalCase (`UserCard.tsx`) or kebab-case both fine.
- Omit `import React from 'react'` (modern JSX transform).

## JSX

- Attribute quotes: single quotes.
- Prop order: reserved props (`key`, `ref`) first → shorthand booleans → alphabetized → callbacks last.

## Props

- Props type named `ComponentNameProps`, declared with `type`.
- Destructure props in the signature.
- Default values via default parameters (`({ size = 'md' }: Props)`).

## Hooks

- Custom hook files: `kebab-case` `use-something.ts`; function named `useSomething`.

## Next.js

- Keep `'use client'` boundaries as low in the tree as possible.
- Components live in a top-level `components/`, imported as `@/components/...`.

## Event handlers

- Internal handler named `handleX`; the prop it's passed to is `onX`.

## Accessibility

- See `accessibility.md` — WCAG 2.2, Level AA minimum.
