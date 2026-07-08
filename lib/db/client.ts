import { Pool, type PoolConfig, type QueryResultRow } from "pg";

let pool: Pool | undefined;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an id is a real UUID. Postgres uuid columns reject anything else, so
 * a non-UUID id (e.g. the demo "team-1") can never match a row -- callers use
 * this to 404 instead of letting a failed query fall back to mock data.
 */
export function isUuid(value: string) {
  return uuidPattern.test(value);
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  pool ??= new Pool(getDatabasePoolConfig());

  return pool;
}

export function getDatabasePoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const shouldUseSsl = connectionString.includes("sslmode=require") || connectionString.includes("neon.tech");
  const poolConnectionString = stripPgSslMode(connectionString);
  // Verify the server certificate by default; skipping verification exposes
  // the connection to MITM. DATABASE_SSL_NO_VERIFY=true is the escape hatch
  // for endpoints with self-signed certs.
  const sslConfig = process.env.DATABASE_SSL_NO_VERIFY === "true" ? { rejectUnauthorized: false } : true;

  return {
    connectionString: poolConnectionString,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
    ssl: shouldUseSsl ? sslConfig : undefined,
  };
}

function stripPgSslMode(connectionString: string) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return connectionString;
  }
}

export async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  return getPool().query<T>(sql, values);
}

/** Postgres unique-violation (23505), e.g. from a concurrent duplicate insert. */
export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23505");
}

/**
 * Run a database operation with a graceful fallback. Use this ONLY when the
 * fallback is a safe empty/neutral state (no data, not authenticated, no live
 * game) — never fabricated sample data. In demo mode (no DATABASE_URL) the
 * fallback stands in for the whole feature; with a database configured, a
 * failure degrades to the same neutral state rather than erroring.
 */
export async function tryDatabase<T>(operation: () => Promise<T>, fallback: () => T | Promise<T>) {
  if (!isDatabaseConfigured()) {
    return fallback();
  }

  try {
    return await operation();
  } catch (error) {
    console.warn("Database operation failed; falling back to neutral state.", error);
    return fallback();
  }
}

/**
 * Run a database operation whose fallback is fabricated demo/sample data. The
 * demo fallback is served ONLY when no database is configured. When a database
 * IS configured, a failure propagates so the caller surfaces an error (e.g.
 * 503) — a transient outage must never masquerade as real data to a signed-in
 * user.
 */
export async function withDemoFallback<T>(operation: () => Promise<T>, demoFallback: () => T | Promise<T>) {
  if (!isDatabaseConfigured()) {
    return demoFallback();
  }

  return operation();
}
