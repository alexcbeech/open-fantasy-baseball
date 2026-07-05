import { isDatabaseConfigured } from "@/lib/db/client";
import { getJobHandler } from "./handlers";
import { claimNext, completeJob, failJob, reclaimStaleJobs } from "./queue";

export type DrainSummary = {
  reclaimed: number;
  claimed: number;
  succeeded: number;
  failed: number;
  /** Distinct job types that ran, for the log line and admin response. */
  jobTypes: string[];
};

export type DrainOptions = {
  runnerId?: string;
  /** Safety bound so a runaway requeue loop can't spin forever in one drain. */
  maxJobs?: number;
  staleMs?: number;
  now?: Date;
};

/**
 * Drain the job queue: reclaim stale jobs, then claim and run due jobs one at a
 * time until none remain or `maxJobs` is hit. Concurrency-safe via SKIP LOCKED
 * (in claimNext), so multiple drainers can run at once without double-work. Each
 * job is isolated, so one failure never stops the drain.
 */
export async function drainQueue(options: DrainOptions = {}): Promise<DrainSummary> {
  const runnerId = options.runnerId ?? `runner-${process.pid}`;
  const maxJobs = options.maxJobs ?? 100;
  const now = options.now ?? new Date();

  const summary: DrainSummary = { reclaimed: 0, claimed: 0, succeeded: 0, failed: 0, jobTypes: [] };

  if (!isDatabaseConfigured()) {
    return summary;
  }

  summary.reclaimed = await reclaimStaleJobs(now, options.staleMs);

  const seenTypes = new Set<string>();

  while (summary.claimed < maxJobs) {
    const job = await claimNext(runnerId);
    if (!job) {
      break;
    }

    summary.claimed += 1;
    seenTypes.add(job.jobType);
    const handler = getJobHandler(job.jobType);

    if (!handler) {
      summary.failed += 1;
      await failJob(job, `No handler registered for job type "${job.jobType}".`);
      continue;
    }

    try {
      const result = await handler(job.payload);
      summary.succeeded += 1;
      await completeJob(job.id, result);
    } catch (error) {
      summary.failed += 1;
      await failJob(job, error);
    }
  }

  summary.jobTypes = [...seenTypes];
  return summary;
}
