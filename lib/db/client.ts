import { Pool, type PoolConfig, type QueryResultRow } from "pg";

let pool: Pool | undefined;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
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

  return {
    connectionString: poolConnectionString,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
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

export async function tryDatabase<T>(operation: () => Promise<T>, fallback: () => T | Promise<T>) {
  if (!isDatabaseConfigured()) {
    return fallback();
  }

  try {
    return await operation();
  } catch (error) {
    console.warn("Database operation failed; falling back to mock data.", error);
    return fallback();
  }
}
