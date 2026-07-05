import { finalizeEndedMatchups, recomputeMatchups } from "@/lib/data/matchup-scoring";
import { drainNotifications } from "@/lib/data/notifications";
import { runNightlyProcessing } from "./nightly-processing";

/**
 * A job handler runs the work for one job_type and returns a JSON-serializable
 * result stored on the job row. Handlers must be idempotent: a job can be
 * retried, so running it twice must be safe.
 */
export type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

export const jobHandlers: Record<string, JobHandler> = {
  // Waiver resolution + transaction audit. runNightlyProcessing already filters
  // to pending, due claims under `for update`, so a retry is safe.
  nightly_processing: async () => runNightlyProcessing(),
  // Recompute every active matchup's category battle from current lineups and
  // fresh stats; an upsert-only recompute, safe to repeat. Standings are
  // read-derived from these scores, so this keeps them fresh too.
  recompute_matchups: async () => recomputeMatchups(),
  // Snapshot + lock matchups whose scoring period has closed. Once a period is
  // final it is skipped, so re-running is a no-op.
  finalize_ended_matchups: async () => finalizeEndedMatchups(),
  // Deliver queued push notifications (waiver results, etc.). Sent rows are no
  // longer pending, so a retry only picks up anything left unsent.
  send_notifications: async () => drainNotifications(),
};

export function getJobHandler(jobType: string): JobHandler | null {
  return jobHandlers[jobType] ?? null;
}
