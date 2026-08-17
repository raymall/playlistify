# Browser verification

Applies whenever verifying something in a browser — Claude Browser, the preview pane (`preview_start` / `.claude/launch.json`), or any automated browsing.

## Logins are the user's to do

- **Never log in on the user's behalf.** If a page needs authentication — Spotify OAuth, a Supabase session, 2FA, an expired session — stop and ask the user to log in in Claude Browser, then continue once they confirm.
- Do not route around the login. No entering credentials, no lifting tokens or cookies out of `.env.local` / the repo / the `spotify_accounts` table, no calling the route handlers or the Spotify API directly as a substitute for seeing the UI, no seeding a fake session, no service-role client to impersonate a user, no switching to computer-use to drive a browser window instead.
- Same for anything else only the user can do in the browser: granting Spotify scopes, approving a consent dialog. Ask; don't improvise.

## How to ask

- One line: what page, what to log into, and what will be checked once they're in. Then wait.
- Do everything that doesn't need the login first, so the ask arrives once and late rather than blocking the whole task.
- If the user declines, say plainly what stays unverified — never report it as verified, and never quietly substitute a weaker check without flagging it.
