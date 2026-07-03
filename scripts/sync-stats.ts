import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { syncPlayerStats } from "../lib/data/mlb-stats-sync";

async function main() {
  const result = await syncPlayerStats();
  console.log(
    `synced ${result.season} player stats (${result.rowsWritten} lines written from ${result.rowsSeen} splits, ${result.rosteredPlayers} rostered players, source ${result.source})`,
  );
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
