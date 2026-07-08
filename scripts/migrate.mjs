import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getDatabasePoolConfig } from "./db-config.mjs";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const migrationsDir = path.join(rootDir, "db", "migrations");

const pool = new Pool(getDatabasePoolConfig());

async function main() {
  await pool.query(`
    create table if not exists schema_migration (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const migrations = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const filename of migrations) {
    const existing = await pool.query("select 1 from schema_migration where filename = $1", [filename]);

    if (existing.rowCount) {
      console.log(`skipping ${filename}`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migration (filename) values ($1)", [filename]);
      await client.query("commit");
      console.log(`applied ${filename}`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
