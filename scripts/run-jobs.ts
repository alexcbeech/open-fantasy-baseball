import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";
import { enqueue } from "../lib/jobs/queue";
import { dedupKeyForDaily } from "../lib/jobs/queue-policy";
import { drainQueue } from "../lib/jobs/runner";

// Scheduled entrypoint (GitHub Actions cron / manual dispatch): enqueue the
// day's recurring jobs (dedup-keyed so a re-run no-ops) and drain the queue.
async function main() {
  if (!isDatabaseConfigured()) {
    console.log("DATABASE_URL is not set; skipping job run.");
    return;
  }

  const now = new Date();

  // Priority orders the drain (lower runs first): resolve waivers, then
  // recompute matchup scores on the resulting rosters, then snapshot/lock any
  // scoring periods that have ended. Each is dedup-keyed per day.
  const recurring = [
    { jobType: "nightly_processing", priority: 0 },
    // After waivers so bot lineups see the day's roster changes, before the
    // matchup recompute so scores reflect the lineups bots just set.
    { jobType: "set_bot_lineups", priority: 3 },
    { jobType: "recompute_matchups", priority: 5 },
    { jobType: "finalize_ended_matchups", priority: 10 },
    // Runs last so it delivers notifications the jobs above produced.
    { jobType: "send_notifications", priority: 15 },
  ];

  for (const { jobType, priority } of recurring) {
    const result = await enqueue(jobType, { dedupKey: dedupKeyForDaily(jobType, now), priority });
    console.log(`${jobType} ${result.deduped ? "already queued" : "enqueued"} (${result.id})`);
  }

  const summary = await drainQueue({ now });
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
