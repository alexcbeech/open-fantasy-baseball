# Open Fantasy Baseball

Open Fantasy Baseball (OFB) is a mobile-first fantasy baseball app influenced by the day-to-day usability of Yahoo Fantasy Sports: fast team switching, lineup management, matchup scoring, deep player search, commissioner controls, and configurable notifications.

## Current Stack

- Next.js, React, and TypeScript for the web/PWA app.
- Versioned API routes under `/api/v1`.
- PostgreSQL for durable league, roster, scoring, job, and audit data.
- A PostgreSQL-backed durable job queue; Redis remains available for future shared caching and high-volume fanout.
- Neon Auth for user authentication; scoped owner API tokens stay in OFB's database.
- Provider adapters for MLB stats, rosters, projections, and player news.

## Local Development

Install Node.js 24, then install the exact locked dependency tree and start the development server:

```bash
npm ci
npm run dev
```

The app runs with bundled mock data when no database is configured. To use local or managed services, copy `.env.example` to `.env.local` and fill in only the values you need. PowerShell installations that block the `npm.ps1` shim can use `npm.cmd` in place of `npm`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and required checks.

## Database And Data Sync

Use a managed Postgres database such as Neon by setting `DATABASE_URL` in `.env.local`. See `docs/neon.md`.

For local containers, start Postgres and Redis:

```bash
docker compose up -d
```

Apply migrations and seed development data:

```bash
npm run db:setup
```

Sync MLB teams, active rosters, 40-man rosters, schedules, and probable starters from the MLB Stats API:

```bash
npm run sync:mlb
```

Ingest real player stats from the MLB Stats API — season stats for every known player plus game logs and trailing 7/14/30-day splits for rostered players (`lib/data/mlb-stats-sync.ts`):

```bash
npm run sync:stats
```

Refresh derived rest-of-season projections and synthesized player news. Both are provider-adapter based (`lib/data/projections-sync.ts`, `lib/data/player-news-sync.ts`): the default providers derive data from stats and schedule OFB already ingests, and a real projections/news feed can be dropped in by implementing the same interface. Each run records an `ingestion_run` row for freshness and source attribution.

```bash
npm run sync:projections
npm run sync:news
```

Populate the schedule/probable starters and player bios (jersey numbers) on their own:

```bash
npm run sync:schedule
npm run sync:bios
```

Recompute each active matchup from the current lineups' real stats (`lib/data/matchup-scoring.ts`). Category leagues sum counting categories and rebuild AVG/ERA/WHIP from components (H/AB and IP/ER/P_BB/P_H). Points leagues use Yahoo-compatible, league-persisted weights:

- Batters: 1B 2.6, 2B 5.2, 3B 7.8, HR 10.4, R 1.9, RBI 1.9, BB 2.6, SB 4.2, HBP 2.6.
- Pitchers: SV 8, W 8, K 3, ER -3, O 1, BB -1.3, H -1.3, HBP -1.3.

Pitching categories that overlap batting names are stored internally as `P_BB`, `P_H`, and `P_HBP`; `O` is derived exactly from MLB innings notation. The stats sync imports complete season game logs so newly added scoring fields and both games of a doubleheader are retained.

```bash
npm run sync:matchups
```

Pull draft-market ADP (average draft position) from ESPN's public fantasy API, ID-matched to OFB players via the smartfantasybaseball player id map with a name-match fallback. If the external feed is unreachable, ranks are derived from season fan points instead, so the draft board always has an order:

```bash
npm run sync:adp
```

Recommended sync order for real data: `sync:mlb` (teams, rosters) → `sync:schedule` → `sync:bios` → `sync:stats` (real stats) → `sync:projections` (derives from real stats) → `sync:news` → `sync:matchups` → `sync:adp`.

`npm run seed:opponent` drafts a real lineup onto the seeded opponent team so the demo matchup has two full rosters to score.

The app uses Postgres automatically when `DATABASE_URL` is set. Without `DATABASE_URL`, it falls back to the bundled mock data so the UI remains usable.

## Background Jobs

Domain processing — waiver resolution, matchup recomputation and finalization, and notification delivery — runs through a durable Postgres-backed job queue (`job_queue` table, migration `0007`). There is no always-on worker: jobs are claimed with `SELECT … FOR UPDATE SKIP LOCKED`, so the queue is safe to drain from ephemeral CI runners (or many runners at once) with no extra infrastructure. This is deliberately separate from the data *syncs* above, which stay plain cron steps (ingestion, with their own `ingestion_run` audit); the queue owns *processing*.

```bash
npm run jobs:run
```

`jobs:run` (`scripts/run-jobs.ts`) enqueues the day's recurring jobs with per-day dedup keys and `priority` ordering, then drains the queue: it reclaims any jobs a crashed runner left `running`, then claims and runs each due job. A handler that throws is retried with exponential backoff (30s, 60s, 120s… capped at an hour) up to `max_attempts`, after which the job is marked `dead` with its `last_error`. Handlers must be idempotent, since a retry re-runs the whole job. The recurring jobs, in run order:

1. `nightly_processing` — resolve due waiver claims (only touches `pending` claims under `for update`).
2. `recompute_matchups` — recompute every active matchup's category battle from current lineups and fresh stats (upsert-only). Standings are read-derived from these scores, so this keeps them current too. (This replaced the standalone `sync:matchups` workflow step; the npm script remains for manual runs.)
3. `finalize_ended_matchups` — snapshot and lock matchups whose scoring period has closed (`active → final`), so live recompute stops touching them.
4. `send_notifications` — drain the notification outbox and deliver queued push notifications, so this runs after the jobs that produce them.

Notifications use a durable outbox (`notification_outbox`, migration `0008`): a producer inserts a row **inside its own transaction** — e.g. waiver resolution queues a "claim won/lost" push via `enqueueNotificationForTeam` (bot teams are skipped) — and `send_notifications` later delivers each pending row through the existing `sendPushToUser` Web Push helper, marking it `sent`/`failed`. This decouples push latency and flakiness from the domain write; a manager with no subscribed devices is a successful no-op.

- **Scheduled:** the nightly workflow (`.github/workflows/nightly-sync.yml`) runs `jobs:run` as its final step, after the syncs, so processing sees fresh data. Its `concurrency` group prevents overlapping runs.
- **On demand:** the admin Operations screen's "Run nightly" button (`POST /api/v1/admin/jobs/nightly`) enqueues a `nightly_processing` job and drains the queue, returning the drain summary; recent queue rows (type · status · attempts · error) show under **Job Queue** on that screen.
- **Add a handler:** register a `job_type → async fn` in `lib/jobs/handlers.ts`; enqueue with `enqueue(jobType, opts)` from `lib/jobs/queue.ts`. Pure scheduling logic (backoff, retry-vs-dead, dedup keys) lives in `lib/jobs/queue-policy.ts` and is unit-tested.

## Live In-Game Stats

While MLB games are in progress, the Team tab and the player detail sheet show live fantasy points and the current inning, updating as the game plays. This is intentionally separate from the nightly sync: it reads directly from the free MLB Stats API on demand (`/schedule`, `/game/{pk}/boxscore`, `/game/{pk}/linescore`) rather than the database, so no poller or extra sync job is needed.

- `GET /api/v1/players/{playerId}/live` returns one player's in-progress line, points, and inning state (or `live: false`).
- `GET /api/v1/teams/{teamId}/live` returns live boxscore lines plus confirmed batting-order status for the team's lineup. Posted MLB lineups come from the schedule's `lineups` hydration in one cached request; the UI shows the order spot or a red X and refreshes it before Start Active Players runs.
- `GET /api/v1/teams/{teamId}/matchup/live` recomputes the active matchup's category battle from each side's season stats plus live in-game lines, so the Matchup tab's category values, categories-won score, and per-player points move during games (`lib/data/live-matchup.ts`). The live line is appended as an extra stat entry per player so counting categories sum and rate categories (AVG/ERA/WHIP) are rebuilt from summed components.
- The lineup rows, the open detail sheet, and the Matchup tab poll these every 30s; when no relevant game is in progress they simply show season points, the next scheduled game, and the stored nightly category battle. In demo/mock mode (blank `DATABASE_URL`) the routes return the not-live result. See `lib/data/mlb-live.ts`.
- MLB reads go through a short-TTL, single-flight cache (`cachedFetchJson` in `lib/data/mlb-live.ts`): concurrent requests for the same schedule/boxscore/linescore share one upstream fetch, and repeats within the TTL (60s schedule, 15s boxscore/linescore) read the memoized value — so the polling fanout across routes, tabs, and users collapses to roughly one MLB request per URL per TTL. The cache is per server instance; a shared Redis cache is the path if OFB ever runs multi-instance under load.

## Live Snake Draft

Leagues start in `pre_draft`. From the home screen's Drafts card (or `/draft/{leagueId}`), the commissioner names their team, fills open seats with bots, sets the pick clock (30–120s), orders the seats, and starts the draft. The mobile draft room shows an on-the-clock banner with a server-authoritative countdown, a recent-picks ticker, an ADP-ranked available-player list (filtered to the league's player pool: All MLB, AL-only, or NL-only), a round-by-round board, and remaining roster needs.

There is no background worker: the pick clock advances lazily. Every draft-state read (the room polls every 3s) and every pick attempt first resolves expired turns inside a row-locked transaction — bots pick ~5s after going on the clock, and a human whose clock runs out gets the best available player by ADP adjusted for roster needs (`lib/draft/`). Completing the final pick flips the league to `active` and auto-assigns each team's initial lineup (starters first, overflow to bench). In demo/mock mode the room renders a frozen sample draft read-only; picks require a configured database.

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

## Progressive Web App

OFB is installable from supporting browsers through `app/manifest.ts`. On iPhone and iPad, use **Share → Add to Home Screen**; on Android and desktop Chromium, use the in-app install suggestion or the browser's install action. The installed app uses standalone display mode, home-screen icons, safe-area-aware layouts, and the same Web Push controls as the website.

In production, the service worker is registered for every page. It intentionally does not cache authenticated league pages, because those responses contain private and fast-changing data. If a navigation fails without a connection, it serves a small cached offline page; reconnect before viewing data or submitting lineup changes.

## Testing

Unit tests (Vitest) cover scoring, roster legality, league settings, waiver priority/FAAB, ingestion adapters, and API helpers:

```bash
npm test
```

Playwright smoke tests exercise the mobile landing, team tabs, player search, and commissioner settings. They run the app in demo/mock mode (blank `DATABASE_URL`/Neon Auth env), so they need no database or sign-in:

```bash
npm run test:e2e
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

## License

Open Fantasy Baseball is licensed under the [Apache License 2.0](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for material incorporated from other projects.

The software license does not grant rights to third-party trademarks or data referenced by the project.
