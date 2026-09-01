# Playlistify

Turn the music you already like into playlists you'd never think to build.
Playlistify imports your Spotify Liked Songs, enriches every track with
AI-inferred genres, moods, energy, and era, and then lets you describe a
playlist in plain language — "something warm for a rainy Sunday, nothing too
sad" — and creates it in your Spotify account, built only from songs you
already saved.

The Spotify app behind this project runs in development mode, which caps it at
25 manually allowlisted users, and that list is closed. To use Playlistify you
run your own instance with your own Spotify app — the setup below covers
everything.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 + shadcn/ui (Base UI) ·
Supabase (Postgres + Auth via Spotify OAuth) · Vercel AI SDK 7 (OpenAI by
default; the provider is swappable).

## Prerequisites

- Node.js 24 (`.nvmrc` — use `nvm`)
- A [Supabase](https://supabase.com) project (free tier is fine)
- A [Spotify Developer](https://developer.spotify.com/dashboard) app
- An OpenAI API key (enrichment + chat)

## Setup

1. `nvm install && nvm use`, then `npm install`.
2. **Spotify app** (developer.spotify.com/dashboard): create an app and add
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` as a Redirect URI.
   The app starts in development mode — add yourself (and anyone else, up to 25) under User Management or sign-in will be refused.
3. **Supabase dashboard**: enable the Spotify provider with your Spotify app's
   client id/secret (Authentication → Sign In / Providers) and set Site URL to
   `http://localhost:3000` (Authentication → URL Configuration).
4. **Env**: `cp .env.example .env.local` and fill in every value — the comments
   in the file say where each one comes from.
5. **Database**: `npx supabase link --project-ref YOUR-REF`, then
   `npx supabase db push` to apply the migrations.
6. **Enrichment recipes**: `npm run recipe:sync` to preview, then
   `npm run recipe:sync -- --yes` to apply. A fresh database has no recipes
   until this runs, and nothing can be analyzed without one.
7. `npm run dev` and open http://localhost:3000.

## Develop

```bash
npm run dev           # dev server on :3000
npm run lint          # eslint
npm run lint:css      # stylelint
npm run format:check  # prettier --check (format to write)
npm run typecheck     # tsc --noEmit
npm run build         # production build
```

After a schema change, regenerate types with `npm run gen:types` (never the
bare supabase CLI command). The `npm run verify:*` scripts live-check
individual domains — RLS, import, enrichment, recipes, playlists, chat —
against the linked Supabase project; each file in `scripts/` says what it
proves.

## Documentation

- [MVP-PLAN.md](./MVP-PLAN.md) — product spec: scope, features, schema.
- [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) — what the product decides and why, in
  plain language.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — codebase map: directories, routes,
  core flows, invariants.
- [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) — visual system.
- [IMPROVEMENTS.md](./IMPROVEMENTS.md) — known sharp edges and deferred work.
