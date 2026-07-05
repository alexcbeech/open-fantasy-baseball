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
};

export function getJobHandler(jobType: string): JobHandler | null {
  return jobHandlers[jobType] ?? null;
}
