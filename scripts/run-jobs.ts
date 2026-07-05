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
  const nightly = await enqueue("nightly_processing", {
    dedupKey: dedupKeyForDaily("nightly_processing", now),
  });
  console.log(`nightly_processing ${nightly.deduped ? "already queued" : "enqueued"} (${nightly.id})`);

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
