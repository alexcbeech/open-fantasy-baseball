import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { reconcileOffseasonPositionEligibility } from "../lib/data/position-eligibility";

async function main() {
  const upcomingSeason = Number(process.argv[2]);
  const pool = getPool();
  const client = await pool.connect();

  try {
    const result = await reconcileOffseasonPositionEligibility(client, upcomingSeason);
    console.log(
      `expired ${result.expired} stale hitter position eligibilities for ${result.upcomingSeason} (valid through ${result.effectiveThrough})`,
    );
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
