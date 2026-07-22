---
paths:
  - '**/*.{tsx,jsx,html,liquid,css,scss}'
  - 'public/**/*.js'
---

# Accessibility (WCAG)

## Version & target

- Standard: WCAG 2.2 — the latest W3C Recommendation. Adopt newer versions once they reach Recommendation status. WCAG 3.0 is a Working Draft (different conformance model) — never target it unless a project explicitly requires it.
- Default conformance target: **Level AA minimum**, always — even when the project doesn't mention accessibility.
- Levels are cumulative: AA = all Level A + AA criteria; AAA = all A + AA + AAA.
- If the user or project scope specifies a level, that becomes the target. "Enforce AAA" means meeting A and AA too.
- W3C notes full-site AAA isn't achievable for all content — when targeting AAA, apply every criterion the content allows and explicitly flag any that can't be met.

## What each level entails

- **Level A — essential floor.** Without it, content is inaccessible to some users: text alternatives for non-text content; captions for prerecorded media; info, structure, and relationships in markup (not visuals alone); full keyboard operability with no traps; no content that flashes >3×/second; skip links / bypass blocks; page titles; meaningful link purpose; labels on inputs; correct name, role, value on UI components.
- **Level AA — the standard bar** (legal baseline in most jurisdictions): text contrast ≥ 4.5:1 (3:1 for large text); non-text/UI contrast ≥ 3:1; text resizable to 200% and reflow at 320px without loss; orientation not locked; visible, unobscured focus indicators; consistent navigation and identification; error identification and suggestions; status messages announced without focus; pointer targets ≥ 24×24px; alternatives to dragging; accessible authentication (no cognitive-function tests).
- **Level AAA — enhanced:** text contrast ≥ 7:1 (4.5:1 large); sign-language interpretation for media; no timing on interactions; no interruptions; keyboard operability without exception; context-sensitive help; reading-level support; pointer targets ≥ 44×44px; link purpose clear from link text alone.

## In practice

- Semantic HTML first; ARIA only to fill real gaps — no ARIA beats wrong ARIA.
- Everything reachable and operable by keyboard; manage focus on dialogs, menus, and route changes.
- Every form control labeled; errors described in text and associated via `aria-describedby`.
- Async/streamed updates announced via live regions (`aria-live`, `role='status'`).
- Never convey meaning by color alone; honor `prefers-reduced-motion`.
- Contrast, target size, and focus visibility checked against the target level before delivering.
