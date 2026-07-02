# Open Fantasy Baseball

Open Fantasy Baseball (OFB) is a mobile-first fantasy baseball app influenced by the day-to-day usability of Yahoo Fantasy Sports: fast team switching, lineup management, matchup scoring, deep player search, commissioner controls, and configurable notifications.

## Initial Stack

- Next.js, React, and TypeScript for the web/PWA app.
- Versioned API routes under `/api/v1`.
- PostgreSQL planned for durable league, roster, scoring, and audit data.
- Redis planned for queues, cache, live-score fanout, and rate limiting.
- Neon Auth planned for user auth; scoped owner API tokens stay in OFB's database.
- Provider adapters planned for stats, rosters, projections, and player news.

## Local Development

```bash
npm.cmd install
npm.cmd run dev
```

PowerShell may block `npm`; on Windows, `npm.cmd` avoids the script execution policy issue.

## Database And Data Sync

Use a managed Postgres database such as Neon by setting `DATABASE_URL` in `.env.local`. See `docs/neon.md`.

For local containers, start Postgres and Redis:

```bash
docker compose up -d
```

Apply migrations and seed development data:

```bash
npm.cmd run db:setup
```

Sync MLB teams, active rosters, 40-man rosters, schedules, and probable starters from the MLB Stats API:

```bash
npm.cmd run sync:mlb
```

The app uses Postgres automatically when `DATABASE_URL` is set. Without `DATABASE_URL`, it falls back to the bundled mock data so the UI remains usable.

## Auth

OFB uses Neon Auth with the `@neondatabase/auth` Next.js server SDK. Add the Neon Auth variables to `.env.local` to enable browser sign-in:

```bash
NEON_AUTH_BASE_URL="https://your-neon-auth-host/neondb/auth"
NEON_AUTH_COOKIE_SECRET="generate-at-least-32-characters"
```

The auth proxy handler lives at `/api/auth/*`, and OFB provides app-native pages at `/auth/sign-in` and `/auth/sign-up`. OFB maps signed-in Neon users into its own `app_user` and `auth_identity` tables so league roles, preferences, and owner API tokens remain portable.

For local development, use `http://localhost:3000` for browser auth flows. Neon Auth treats `http://127.0.0.1:3000` as a different origin; OFB redirects `127.0.0.1` to `localhost` in development to avoid invalid-origin sign-in and sign-up failures.

## Current Shape

- `app/` contains the mobile-first Next.js screens.
- `app/api/v1/` contains early API route contracts.
- `db/migrations/` contains the initial PostgreSQL schema.
- `lib/fantasy/` contains league defaults, mock data, and scoring helpers.
- `lib/data/` contains database repositories and MLB ingestion.
- `lib/auth/` contains OAuth scope definitions.
- `lib/jobs/` contains the nightly processing checklist.
- `TODO.md` is the working implementation backlog.
