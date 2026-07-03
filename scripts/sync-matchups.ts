import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { recomputeMatchups } from "../lib/data/matchup-scoring";

async function main() {
  const result = await recomputeMatchups();
  console.log(`recomputed ${result.matchups} active matchups (${result.categoriesWritten} category scores)`);
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
