import "./load-env.mjs";
import { syncMlbTeamsAndRosters } from "../lib/data/mlb-sync";

async function main() {
  const result = await syncMlbTeamsAndRosters();
  console.log(
    `synced MLB teams, active rosters, 40-man rosters, and schedule (${result.rowsSeen} rows seen, ${result.scheduleRowsSeen} games)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
