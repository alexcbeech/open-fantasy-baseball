/**
 * Pure job-queue policy: retry/backoff timing and dedup-key construction. Kept
 * DB-free so the scheduling rules are unit-testable without a database.
 */

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_CAP_SECONDS = 3600;

/**
 * Exponential backoff for a retry after `attempts` failed tries: 30s, 60s,
 * 120s, ... capped at one hour. `attempts` is the number already made (>= 1
 * when a retry is being scheduled).
 */
export function backoffSeconds(attempts: number): number {
  const exponent = Math.max(0, Math.floor(attempts) - 1);
  const raw = BACKOFF_BASE_SECONDS * 2 ** exponent;
  return Math.min(BACKOFF_CAP_SECONDS, raw);
}

export type NextAttemptState = {
  status: Extract<JobStatus, "queued" | "dead">;
  /** When to retry; null once the job is dead. */
  runAt: Date | null;
};

/**
 * Decide what happens to a job after a failed (or reclaimed) attempt: retry
 * with backoff while attempts remain, otherwise mark it dead.
 */
export function nextAttemptState(attempts: number, maxAttempts: number, now: Date): NextAttemptState {
  if (attempts >= maxAttempts) {
    return { status: "dead", runAt: null };
  }

  return {
    status: "queued",
    runAt: new Date(now.getTime() + backoffSeconds(attempts) * 1000),
  };
}

/**
 * Dedup key for a once-per-day job, e.g. `nightly_processing:2026-07-05`, so a
 * re-triggered workflow on the same day no-ops instead of double-enqueuing.
 */
export function dedupKeyForDaily(jobType: string, date: Date): string {
  return `${jobType}:${date.toISOString().slice(0, 10)}`;
}
