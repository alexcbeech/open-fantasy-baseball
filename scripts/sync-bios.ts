import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { syncPlayerBios } from "../lib/data/mlb-stats-sync";

async function main() {
  const result = await syncPlayerBios();
  console.log(`synced player bios (${result.rowsWritten} updated from ${result.rowsSeen} people, source ${result.source})`);
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
