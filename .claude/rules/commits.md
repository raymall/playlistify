# Commit messages

Conventional Commits.

## Branching

- **Never create a branch without being asked.** Commit to the branch already
  checked out — including `main`, which is where this project's history lives.
- `git checkout -b` / `git branch` require an explicit request for a branch.
  Generic "don't commit to the default branch" advice does not apply here.
- If a branch genuinely looks warranted, say so in one line and let the user
  decide; never create one pre-emptively. An unrequested branch also strands any
  follow-up commits the user makes on top of it.
- Commit only when asked, and push only when asked — they are separate requests.

## Splitting changes

- One logical change per commit. Unrelated changes never share a commit — split them, each with its own header, body, and ticket ref.
- When the working tree mixes concerns, stage selectively (`git add -p` / per-file) rather than committing everything together.
- Related but distinct steps get separate commits in dependency order (e.g. the enabling `refactor` commit first, then the `feat`/`fix` that builds on it).
- Trivial drive-by fixes (typo, lint) may ride along only when they're in files the commit already touches; otherwise they get their own commit.

## Header

`type(scope): [TICKET-ID] subject`

- Types: full standard set — `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Scope: optional; `kebab-case`; the affected area.
- Ticket ID: bracketed `[BUG-1234]`, right after `type(scope): `. Omit when unknown.
- Subject: imperative mood, lowercase first word, no trailing period, no length limit.
- No breaking-change convention.

## Body

- Blank line after the subject, then a `-` bullet list.
- Bullets describe what was done: past tense, leading capital.
- Add a "why" line only when the change isn't obvious.
- No wrapping; keep it short — don't over-explain.

## Footer

- `Ticket Ref [BUG-1234]` when the ticket is known; omit otherwise.
- No other footers.
- Strip `Co-authored-by:` trailers and any `Generated with Claude Code` footer. No emoji anywhere.

## Example

```
feat(cart): [BUG-1234] add quantity stepper

- Added stepper control to the cart line item
- Wired quantity changes to the cart store

Ticket Ref [BUG-1234]
```
