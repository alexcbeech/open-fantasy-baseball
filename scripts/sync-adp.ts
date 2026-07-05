import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { syncAdp } from "../lib/data/adp-sync";

async function main() {
  const result = await syncAdp();
  console.log(
    `synced ADP (${result.playersMatched} players matched from ${result.entriesSeen} entries, source ${result.source})`,
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
