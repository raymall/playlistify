# Pull requests

## Title

Same as the commit header: `type(scope): [TICKET-ID] subject`.
(Merge strategy: rebase.)

## Description

Fixed template, in this order, kept short and to the point:

```
## Ticket
Ticket Ref [SHOP-1234]

## Summary
What this PR does.

## Changes
- Added ...
- Updated ...

## Testing
(optional)

## Screenshots
(optional)

## Notes
(optional)
```

- Changes: `-` bullets, past tense, leading capital, short, no over-explaining (same as the commit body).
- Include a why/context note only when the change is non-obvious, or when introducing breaking changes, major refactors, or new features.
- No checklist.
- Same brevity principle as commits.
