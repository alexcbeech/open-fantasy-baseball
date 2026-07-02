import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { syncProjections } from "../lib/data/projections-sync";

async function main() {
  const result = await syncProjections();
  console.log(`synced rest-of-season projections (${result.rowsWritten} written from ${result.rowsSeen} stat lines, source ${result.source})`);
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
