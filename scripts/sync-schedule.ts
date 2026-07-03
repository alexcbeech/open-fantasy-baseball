import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { syncMlbSchedule } from "../lib/data/mlb-sync";

async function main() {
  const client = await getPool().connect();
  try {
    const rowsSeen = await syncMlbSchedule(client);
    console.log(`synced MLB schedule and probable starters (${rowsSeen} games seen)`);
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (isDatabaseConfigured()) {
      await getPool().end();
    }
  });
