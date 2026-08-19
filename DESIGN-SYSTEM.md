# Playlistify editorial design system

This is the implementation reference for the first neo-brutalist Swiss
editorial release. The interface is intentionally restrained: typography,
artwork, proportion, and rules do the expressive work. Color is structural,
not decorative.

## Principles

1. **Type is the interface.** Titles establish hierarchy before containers do.
2. **Artwork earns space.** Album and playlist covers stay square, large, and
   uncropped beyond their natural square format.
3. **Rules create rhythm.** One- and two-pixel lines divide information; cards
   do not float on shadows.
4. **Green is selective.** The Wake palette appears only where interaction
   benefits from emphasis: buttons, badges, inputs, and their focused states.
   Page surfaces, rules, progress, selection, and loading states stay neutral.
5. **Motion supports language.** The landing background remains the existing
   Wake animation. Taglines continuously decode character by character and
   become static when reduced motion is requested.

## Typography

Fonts are self-hosted by `next/font` at build time.

| Role     | Typeface      | Weight  | Typical size     | Use                                                         |
| -------- | ------------- | ------- | ---------------- | ----------------------------------------------------------- |
| Display  | Archivo Black | 400     | `56–128px` fluid | Page titles, collection titles, large statements            |
| UI/body  | Archivo       | 400–700 | `14–18px`        | Navigation, body copy, form fields, song and playlist names |
| Metadata | IBM Plex Mono | 400–700 | `11–14px`        | Kicker labels, counts, dates, buttons, compact status       |

Core title styles:

- Page title: `clamp(56px, 10vw, 128px)`, `0.82` line height, `-0.055em`
  tracking, title case.
- Section title: `clamp(32px, 5vw, 64px)`, `0.9` line height, `-0.045em`
  tracking, uppercase.
- Card title: `30–48px`, `0.95` line height, `-0.04em` tracking.
- Body: `14px`, approximately `1.5` line height.
- Kicker: IBM Plex Mono `11px`, `0.16em` tracking, uppercase.

## Color

### Light

| Token        | Value     | Use                                  |
| ------------ | --------- | ------------------------------------ |
| Background   | `#F2EFE6` | Warm paper                           |
| Foreground   | `#11110F` | Type, hard rules, and progress       |
| Popover      | `#F8F5ED` | Dialogs and floating menus           |
| Secondary    | `#DED8CA` | Neutral supporting surfaces          |
| Muted        | `#E8E3D8` | Selected rows and loading skeletons  |
| Muted text   | `#68655E` | Supporting copy and metadata         |
| Control      | `#263F2A` | Primary buttons and strong badges    |
| Control soft | `#C7D2BA` | Secondary buttons and badges         |
| Control ring | `#557341` | Input borders and focused-state ring |

### Dark

| Token        | Value     | Use                                  |
| ------------ | --------- | ------------------------------------ |
| Background   | `#11110F` | Neutral black paper                  |
| Foreground   | `#F2EFE6` | Type, hard rules, and progress       |
| Popover      | `#191917` | Dialogs and floating menus           |
| Secondary    | `#2C2A26` | Neutral supporting surfaces          |
| Muted        | `#24231F` | Selected rows and loading skeletons  |
| Muted text   | `#AAA69C` | Supporting copy and metadata         |
| Control      | `#557341` | Primary buttons and strong badges    |
| Control soft | `#263F2A` | Secondary buttons and badges         |
| Control ring | `#8CA462` | Input borders and focused-state ring |

Destructive states retain the established red semantic token. No state relies
on color alone; it always includes a label or icon with an accessible name.

## Layout and spacing

- Authenticated pages use a maximum width of `1600px` with `16px`, `24px`, and
  `40px` responsive gutters.
- Authenticated pages reserve bottom space equal to the pinned Chandler cutout
  plus `32px`, so final content and controls scroll fully clear of it.
- The spacing rhythm is based on `4px`; primary intervals are `8`, `16`, `24`,
  `32`, `40`, and `56px`.
- Page headers end in a `2px` rule and bottom-align the title block with its
  actions on wide screens.
- Corners remain square (`0px` radius). Shadows are absent from content and
  controls; layer separation comes from borders and contrast.
- Desktop chat is a strict `1fr / 2fr` split. Library results use a sticky
  inspector beside the table. Playlist cards use one featured composition,
  followed by a two- or three-column grid.

## Borders and surfaces

- Primary container: `2px` neutral rule at 32% foreground opacity.
- Internal divider: `1px` neutral rule at 32% foreground opacity.
- Focus: `2px` foreground ring with visible offset.
- Muted selection: muted fill plus the existing text/selection state; color is
  never the only selected-state cue.

## Buttons

All buttons use bold IBM Plex Mono, uppercase `12–14px` text, square corners, and a
minimum height of `40px` (`48px` for large actions).

| Variant     | Treatment                                        | Use                                                |
| ----------- | ------------------------------------------------ | -------------------------------------------------- |
| Primary     | Deep green fill, inverse text; reverses on hover | Enrich, Send, Open in Spotify                      |
| Outline     | Transparent fill with a quiet neutral rule       | Sync, Start playlist, See details, utility actions |
| Secondary   | Soft green fill with no visible border           | Search and lower-priority committed actions        |
| Ghost       | No border or fill until hover                    | Clear, reveal, and low-priority utilities          |
| Destructive | Red semantic treatment                           | Irreversible playlist deletion only                |

Primary controls reverse to a strong green outline on hover. Secondary controls
reverse to a softer green outline. Outline controls use a soft green fill on
hover, so none becomes visually identical to an adjacent variant. Badges are
static and never inherit button-like hover states.

Disabled buttons keep their shape and label at 50% opacity. Loading labels use
an ellipsis and preserve the button width when practical.

## Tags and status

- AI-generated genre and mood tags use a **filled secondary** badge.
- Personal genre and mood tags use a **neutral filled** badge.
- Pending confidence uses a neutral outline that matches its text in the
  Library table; its missing numeric value is omitted because the status
  already communicates the state.
- Badges do not print “AI” or “You”; accessible text announces the source.
- Filter badges share one bordered rail and stay grouped under the labels
  Genres, Moods, and Confidence. Each group may contain multiple values.
- Removing a tag uses a visible `×` control with a source- and song-specific
  accessible name.

## Forms and iconography

- Search uses a compact, full-width `48px` field with only a quiet `1px` bottom
  rule. An `8px` gap separates it from a `48px` primary button containing only
  a `24px` Lucide magnifying glass. The field's green border-color shift
  replaces the heavier focus outline.
- Suggestions stay closed on focus and appear only after the query changes.
  Their square, shadowless sheet uses a `1px` neutral rule, labeled groups, and
  restrained green only for the keyboard-highlighted row.
- Text fields and textareas use the neutral input rule and a green focus border
  and ring, so every editable surface shares one language without tinting the
  surrounding panel.
- Use the existing shadcn/ui primitives and Lucide icon set. Icons support
  text; they do not replace unfamiliar labels.
- Focus remains visible on keyboard interaction, and controls meet the WCAG 2.2
  `24px` minimum target floor (primary actions are larger).

## Imagery

- Song rows use `64–72px` square cover art.
- The selected library song and featured playlist use the full available column
  width for artwork.
- Clicking a song cover selects its inspector. Clicking a playlist cover or
  title opens the playlist in Spotify when a live Spotify record exists.
- The Chandler hugging cutout remains pinned to the bottom-right edge on every
  page at the same `clamp(144px, 25vw, 400px)` scale as the homepage and never
  intercepts pointer input.

## Motion

- The existing WebGL Wake background, tuning, and PLAYLISTIFY wordmark effect
  are unchanged.
- Landing taglines dwell for `3200ms`, fade out in `16ms` character steps,
  pause for `140ms`, then fade the next line in character by character. One
  complete shuffled order repeats indefinitely, so every line appears once per
  loop.
- Under `prefers-reduced-motion: reduce`, the tagline remains readable and
  static, and the existing Wake canvas renders its reduced-motion frame.
- UI transitions are limited to color, border, and short focus/pressed feedback.

## Screen-specific decisions

### Homepage

The Wake field and PLAYLISTIFY wordmark remain the primary visual. The tagline
is plain mono text—never drawn as an airport sign—and fades one character at a
time. The
Spotify action is a clean outlined control. Chandler remains pinned at bottom
right at the same scale across every page.

### Library

The current analysis recipe, centered confidence counts, and enriched-song
progress lead into the full-width search. Enrich is the primary action; Sync is
outlined, with its progress and error slot reserved to the button's left so the
header never shifts. Filters remain multi-select and are grouped on one
horizontal line. Pages contain 15 songs. Row tags are comma-separated metadata,
while artwork opens the sticky song inspector where model and personal tags are
shown together, visually distinguished, and edited inline. The selected-song
eyebrow and its confidence status share one vertically centered row. Personal tags
complement AI tags; they never replace them.

### Chat

Conversation occupies one third of the desktop workspace and the editable
playlist preview occupies two thirds. Send spans the conversation panel. The
preview leads with a provisional 2×2 collage sampled from four proposed-song
covers, an editable display title and description, track count, duration, and
its Create playlist action before the scrollable track list. The collage stays
stable while editing and replaces removed-song artwork from the remaining
proposal.

### Playlists

The newest playlist is featured at large scale. Remaining playlists form a
responsive grid. Artwork and titles open Spotify. The featured action order is
the primary Open in Spotify action, then the outlined See details action.
Details expose metadata, prompt, tags, and full-width paired management controls
without an archive section. Start playlist uses the same outlined treatment as
Library's Sync Liked Songs, with the secondary Refresh playlists action beside
it.
