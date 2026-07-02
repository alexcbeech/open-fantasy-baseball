# Neon Setup

Use Neon as the production-style Postgres database for OFB.

## 1. Create A Neon Project

Create a Neon project and database, then copy the pooled connection string. It should look like:

```text
postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
```

## 2. Add `.env.local`

Create `.env.local` in the project root:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
DATABASE_POOL_MAX="5"
MLB_STATS_API_BASE_URL="https://statsapi.mlb.com/api/v1"
```

Do not commit `.env.local`.

The app strips `sslmode` before creating the Node Postgres pool and enables SSL explicitly, which avoids `pg` SSL-mode warnings while keeping Neon connections encrypted.

## 3. Run Migrations And Seed Data

```bash
npm.cmd run db:migrate
npm.cmd run db:seed
```

## 4. Sync MLB Teams And Rosters

```bash
npm.cmd run sync:mlb
```

## 5. Run The App

```bash
npm.cmd run dev
```

When `DATABASE_URL` is present, OFB reads from Neon. Without it, OFB falls back to local mock data.
