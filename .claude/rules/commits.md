# Commit messages

Conventional Commits.

## Header

`type(scope): [TICKET-ID] subject`

- Types: full standard set — `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Scope: optional; `kebab-case`; the affected area.
- Ticket ID: bracketed `[SHOP-1234]`, right after `type(scope): `. Omit when unknown.
- Subject: imperative mood, lowercase first word, no trailing period, no length limit.
- No breaking-change convention.

## Body

- Blank line after the subject, then a `-` bullet list.
- Bullets describe what was done: past tense, leading capital.
- Add a "why" line only when the change isn't obvious.
- No wrapping; keep it short — don't over-explain.

## Footer

- `Ticket Ref [SHOP-1234]` when the ticket is known; omit otherwise.
- No other footers.
- Strip `Co-authored-by:` trailers and any `Generated with Claude Code` footer. No emoji anywhere.

## Example

```
feat(cart): [SHOP-1234] add quantity stepper

- Added stepper control to the cart line item
- Wired quantity changes to the cart store

Ticket Ref [SHOP-1234]
```
