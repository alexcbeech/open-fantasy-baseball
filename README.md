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

Ingest real player stats from the MLB Stats API — season stats for every known player plus game logs and trailing 7/14/30-day splits for rostered players (`lib/data/mlb-stats-sync.ts`):

```bash
npm.cmd run sync:stats
```

Refresh derived rest-of-season projections and synthesized player news. Both are provider-adapter based (`lib/data/projections-sync.ts`, `lib/data/player-news-sync.ts`): the default providers derive data from stats and schedule OFB already ingests, and a real projections/news feed can be dropped in by implementing the same interface. Each run records an `ingestion_run` row for freshness and source attribution.

```bash
npm.cmd run sync:projections
npm.cmd run sync:news
```

Recommended sync order for real data: `sync:mlb` (teams, rosters, schedule) → `sync:stats` (real stats) → `sync:projections` (derives from real stats) → `sync:news`.

The app uses Postgres automatically when `DATABASE_URL` is set. Without `DATABASE_URL`, it falls back to the bundled mock data so the UI remains usable.

## Auth

OFB uses Neon Auth with the `@neondatabase/auth` Next.js server SDK. Add the Neon Auth variables to `.env.local` to enable browser sign-in:

```bash
NEON_AUTH_BASE_URL="https://your-neon-auth-host/neondb/auth"
NEON_AUTH_COOKIE_SECRET="generate-at-least-32-characters"
```

The auth proxy handler lives at `/api/auth/*`, and OFB provides app-native pages at `/auth/sign-in` and `/auth/sign-up`. OFB maps signed-in Neon users into its own `app_user` and `auth_identity` tables so league roles, preferences, and owner API tokens remain portable.

For local development, use `http://localhost:3000` for browser auth flows. Neon Auth treats `http://127.0.0.1:3000` as a different origin; OFB redirects `127.0.0.1` to `localhost` in development to avoid invalid-origin sign-in and sign-up failures.

## Web Push Notifications

OFB delivers injury, trade, waiver, and lineup alerts via the standard VAPID-signed Web Push protocol. Generate a keypair and add it to `.env.local`:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

```bash
WEB_PUSH_PUBLIC_KEY="<publicKey>"
WEB_PUSH_PRIVATE_KEY="<privateKey>"
WEB_PUSH_SUBJECT="mailto:ops@your-domain"
```

Without these keys the feature degrades gracefully: the profile screen reports push as unavailable and the send helpers become no-ops. The service worker lives at `public/sw.js`, per-device enable/disable/test controls are on the profile screen, and subscriptions persist in the `push_subscription` table (endpoints the push service reports as gone are pruned automatically). The `/profile/push` routes are documented in the OpenAPI spec.

## Testing

Unit tests (Vitest) cover scoring, roster legality, league settings, waiver priority/FAAB, ingestion adapters, and API helpers:

```bash
npm.cmd test
```

Playwright smoke tests exercise the mobile landing, team tabs, player search, and commissioner settings. They run the app in demo/mock mode (blank `DATABASE_URL`/Neon Auth env), so they need no database or sign-in:

```bash
npm.cmd run test:e2e
```

## Current Shape

- `app/` contains the mobile-first Next.js screens.
- `app/api/v1/` contains early API route contracts.
- `db/migrations/` contains the initial PostgreSQL schema.
- `lib/fantasy/` contains league defaults, mock data, and scoring helpers.
- `lib/data/` contains database repositories and MLB ingestion.
- `lib/auth/` contains OAuth scope definitions.
- `lib/notifications/` contains the Web Push (VAPID) send helper.
- `lib/jobs/` contains the nightly processing checklist.
- `TODO.md` is the working implementation backlog.
