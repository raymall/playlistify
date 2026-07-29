# Playlistify

Turns your Spotify library into AI-generated playlists through a
conversational interface. See [MVP-PLAN.md](./MVP-PLAN.md) for the full
product and architecture spec.

Stack: Next.js (App Router, TypeScript) · Tailwind CSS + shadcn/ui ·
Supabase (Postgres + Auth, Spotify OAuth) · Vercel AI SDK · Vercel hosting.

## Setup

1. Install and select the project's Node.js version: `nvm install` then
   `nvm use`.
2. `npm install`
3. `cp .env.example .env.local` and fill in every value (see the comments in
   the file for where each one comes from).
4. Supabase dashboard: enable the Spotify provider (Authentication →
   Sign In / Providers) with your Spotify app's client id/secret, and set
   Site URL to `http://localhost:3000` (Authentication → URL Configuration).
5. Spotify app (developer.spotify.com): add
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` as a Redirect URI.
6. Apply database migrations: `npx supabase link --project-ref YOUR-REF`
   then `npx supabase db push`.

## Develop

```bash
npm run dev           # dev server on :3000
npm run lint          # eslint
npm run lint:css      # stylelint
npm run format        # prettier --write
npm run format:check  # prettier --check
npm run typecheck     # tsc --noEmit
npm run build         # production build
```
