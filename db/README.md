# Database

OFB starts with plain PostgreSQL migrations in `db/migrations`. The initial schema keeps fantasy-baseball concepts explicit so the project can adopt Prisma, Drizzle, Kysely, or direct SQL later without losing the domain model.

## Migration 0001

`0001_initial_schema.sql` covers:

- Users, auth identities, OAuth clients, access tokens, preferences, and push subscriptions.
- Leagues, members, teams, settings, roster slots, scoring categories, and commissioner-controlled configuration.
- MLB teams, games, players, position eligibility, player news, and stat lines.
- Scoring periods, matchups, category scores, rosters, and lineup entries.
- Transactions, waiver claims, trade offers, ingestion runs, and background job runs.

The league `settings` JSONB column stores the full versioned settings payload. Tables such as `league_roster_slot` and `league_stat_category` duplicate high-value settings in relational form for validation, search, and scoring queries.

## Commands

```bash
docker compose up -d
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run sync:mlb
```

`sync:mlb` pulls MLB teams, active rosters, 40-man rosters, schedules, and probable starters from `MLB_STATS_API_BASE_URL`, then writes `mlb_team`, `mlb_game`, `player`, `player_position_eligibility`, and `ingestion_run` records.
