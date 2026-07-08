import "./load-env.mjs";

export function getDatabasePoolConfig() {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://ofb:ofb@localhost:5432/ofb";
  const shouldUseSsl = connectionString.includes("sslmode=require") || connectionString.includes("neon.tech");
  const poolConnectionString = stripPgSslMode(connectionString);
  // Verify the server certificate by default (see lib/db/client.ts);
  // DATABASE_SSL_NO_VERIFY=true is the escape hatch for self-signed certs.
  const sslConfig = process.env.DATABASE_SSL_NO_VERIFY === "true" ? { rejectUnauthorized: false } : true;

  return {
    connectionString: poolConnectionString,
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
    ssl: shouldUseSsl ? sslConfig : undefined,
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
