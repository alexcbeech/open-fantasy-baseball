import "./load-env.mjs";

export function getDatabasePoolConfig() {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://ofb:ofb@localhost:5432/ofb";
  const shouldUseSsl = connectionString.includes("sslmode=require") || connectionString.includes("neon.tech");
  const poolConnectionString = stripPgSslMode(connectionString);

  return {
    connectionString: poolConnectionString,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
  };
}

function stripPgSslMode(connectionString) {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return connectionString;
  }
}
