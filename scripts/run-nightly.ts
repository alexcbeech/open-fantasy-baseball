import "./load-env.mjs";
import { getPool } from "../lib/db/client";
import { isDatabaseConfigured } from "../lib/db/client";
import { runNightlyProcessing } from "../lib/jobs/nightly-processing";

async function main() {
  const summary = await runNightlyProcessing();
  console.log(JSON.stringify(summary, null, 2));
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
