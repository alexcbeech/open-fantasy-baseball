import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { syncPlayerNews } from "../lib/data/player-news-sync";

async function main() {
  const result = await syncPlayerNews();
  console.log(`synced player news (${result.rowsWritten} new items from ${result.rowsSeen} players, source ${result.source})`);
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
