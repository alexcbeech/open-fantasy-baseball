# Open Fantasy Baseball TODO

## Now

- [x] Create initial Next.js/TypeScript project scaffold.
- [x] Add persistent implementation TODO list.
- [x] Capture Yahoo-style default league settings in code.
- [x] Build first mobile-first landing and team detail screens.
- [x] Add initial versioned API route contracts.
- [x] Install dependencies and run the first typecheck/build.
- [x] Add database schema and migrations for users, leagues, teams, rosters, players, scoring, transactions, and preferences.

## Product Foundations

- [x] Define complete commissioner setting matrix for H2H categories, H2H points, and roto.
- [x] Add league creation flow using Yahoo-style defaults.
- [x] Add Team tab lineup editing with roster legality validation.
- [x] Add Matchup tab scoring by active player and category.
- [x] Add Players tab search, filters, availability, projected stats, and rolling stat windows.
- [x] Add League tab standings, team stats, settings, and commissioner tools.
- [x] Add player detail sheet with news, game log, season stats, projections, and management actions.
- [x] Add live snake draft: commissioner setup (seats, bots, order, pick clock), mobile draft room (clock banner, ADP-ranked player list, board grid, my-team needs), lazy server clock with auto-pick and bot picks, pause/resume, and post-draft lineup assignment. (Player pool setting supports All/AL-only/NL-only; external ADP via `npm run sync:adp` with derived fallback; auction/offline order strategies stubbed for later.)

## Platform

- [ ] Add OIDC/OAuth2 login with PKCE and passkey/social-login friendly provider support. (Current Neon Auth SDK, API proxy, email/password sign-in/sign-up pages, session boundary, OFB identity mapping, and Neon admin-role detection wired; social providers and production domain settings still pending.)
- [ ] Add scoped OAuth tokens for owner API access. (Scoped personal bearer token create/list/revoke and route scope checks started; full OAuth authorization-code + PKCE flow still pending.)
- [x] Publish OpenAPI docs for public API consumers.
- [ ] Add MCP server after owner API scopes are stable. (First bearer-token protected JSON-RPC MCP tools endpoint started at /api/mcp.)
- [x] Add a durable job runner. (Postgres-backed `job_queue` with `FOR UPDATE SKIP LOCKED` claiming, retry/backoff, dead-lettering, per-day dedup, and stale-job reclaim; `lib/jobs/queue.ts` + `runner.ts` + pure `queue-policy.ts`. Drained by `npm run jobs:run` from the nightly GitHub Actions workflow and the admin ops screen; job-queue rows surfaced in admin. Chose Postgres over Redis/BullMQ since there is no always-on worker. Redis queue still the path only if OFB later needs high-volume/on-demand fanout.)
- [x] Implement nightly waiver and scheduled-task processing via the durable runner. (Waiver resolution runs as the `nightly_processing` handler on the job queue, scheduled nightly after the data syncs. Scoring recalc / matchup snapshots / notification dispatch are now trivial follow-on handlers.)
- [x] Add Web Push notification subscriptions and preference controls. (VAPID-signed Web Push: service worker, per-device subscribe/unsubscribe/test controls on the profile screen, push_subscription persistence with gone-endpoint pruning, and /api/v1/profile/push routes.)
- [x] Add first profile/preferences screen and make the home gear link to it.
- [x] Persist editable profile and notification preferences in Postgres.
- [x] Add light/dark/auto theme support wired to profile preferences.

## Data

- [ ] Implement MLB Stats API adapter for player metadata, teams, schedules, probable starters, and live game stats where allowed. (Teams, active rosters, 40-man rosters, schedule, and probable starters started.)
- [x] Add admin operations screen for manual MLB sync, nightly processing triggers, recent run history, and data freshness summary.
- [x] Add projections provider adapter. (ProjectionsProvider interface with a default derived rest-of-season model computed from season + trailing-30-day stat windows; syncProjections writes projection_ros lines with ingestion_run attribution. `npm run sync:projections`.)
- [x] Add player news provider adapter. (PlayerNewsProvider interface with a default provider synthesizing news from roster status and probable-starter schedule; syncPlayerNews deduped writes to player_news with ingestion_run attribution. `npm run sync:news`.)
- [x] Add ingestion freshness tracking and source attribution.
- [ ] Add scoring recalculation and matchup snapshot jobs. (Matchup detail repository/API and seeded category snapshots started.)
- [x] Add Postgres infrastructure, migrations, seed data, Neon connection support, and repository-backed reads.

## Quality

- [x] Add unit tests for scoring, roster legality, waiver priority, FAAB, and league settings. (Scoring, roster legality, and league settings covered; added focused waiver-priority and FAAB tie-break tests in nightly-processing.test.ts.)
- [ ] Add API contract tests for scoped owner actions. (Manual bearer-token contract smoke and bearer parsing unit tests started.)
- [x] Add Playwright smoke tests for mobile landing, team tabs, player search, and commissioner settings. (e2e/smoke.spec.ts runs against the app in demo/mock mode on a mobile viewport; `npm run test:e2e`, wired into a CI job.)
- [x] Manually smoke test Neon-backed home, team, matchup, players, league, lineup validation, and mobile layout in the browser.
- [x] Add CI with lint, typecheck, tests, and build. (GitHub Actions workflow on push/PR running npm ci, lint, typecheck, test, and next build; .npmrc pins legacy-peer-deps for the beta Neon Auth peer range.)
- [x] Review npm audit output and plan dependency upgrades. (See docs/security-audit.md: 5 moderate transitive advisories, all low exposure in OFB today; documented upstream-tracking plan instead of the breaking `audit fix --force` Next 9.x downgrade.)
