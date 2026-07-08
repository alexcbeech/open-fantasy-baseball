import { getPool, isUniqueViolation } from "@/lib/db/client";
import { nextAttemptState, type JobStatus } from "./queue-policy";

export type JobRow = {
  id: string;
  jobType: string;
  payload: Record<string, unknown>;
  dedupKey: string | null;
  status: JobStatus;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  priority: number;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
};

type DbJobRow = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  dedup_key: string | null;
  status: JobStatus;
  run_at: Date | string;
  attempts: number;
  max_attempts: number;
  priority: number;
  locked_at: Date | string | null;
  locked_by: string | null;
  last_error: string | null;
  result: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapJob(row: DbJobRow): JobRow {
  return {
    id: row.id,
    jobType: row.job_type,
    payload: row.payload ?? {},
    dedupKey: row.dedup_key,
    status: row.status,
    runAt: iso(row.run_at),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    priority: row.priority,
    lockedAt: row.locked_at ? iso(row.locked_at) : null,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    result: row.result ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export type EnqueueOptions = {
  payload?: Record<string, unknown>;
  dedupKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  priority?: number;
};

export type EnqueueResult = { id: string; deduped: boolean };

/**
 * Add a job to the queue. When a `dedupKey` is given and an active (queued or
 * running) job already holds it, this is a no-op that returns the existing job
 * with `deduped: true`. Uses a guarded insert rather than ON CONFLICT because
 * the uniqueness is enforced by a partial index (not a plain constraint).
 */
export async function enqueue(jobType: string, options: EnqueueOptions = {}): Promise<EnqueueResult> {
  const { payload = {}, dedupKey = null, runAt, maxAttempts, priority } = options;

  let insertedId: string | null = null;

  try {
    const inserted = await getPool().query<{ id: string }>(
      `insert into job_queue (job_type, payload, dedup_key, run_at, max_attempts, priority)
       select $1, $2::jsonb, $3, coalesce($4, now()), coalesce($5, 3), coalesce($6, 0)
       where $3::text is null or not exists (
         select 1 from job_queue
         where dedup_key = $3 and status in ('queued', 'running')
       )
       returning id`,
      [jobType, JSON.stringify(payload), dedupKey, runAt ?? null, maxAttempts ?? null, priority ?? null],
    );
    insertedId = inserted.rows[0]?.id ?? null;
  } catch (error) {
    // Two concurrent enqueues can both pass the NOT EXISTS guard; the partial
    // dedup index rejects the loser. Treat that as a normal dedup, not a crash.
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  if (insertedId) {
    return { id: insertedId, deduped: false };
  }

  // The insert was skipped: an active job already holds this dedup key.
  const existing = await getPool().query<{ id: string }>(
    `select id from job_queue where dedup_key = $1 and status in ('queued', 'running') order by created_at limit 1`,
    [dedupKey],
  );

  return { id: existing.rows[0]?.id ?? "", deduped: true };
}

/**
 * Atomically claim the next due job for a runner. FOR UPDATE SKIP LOCKED lets
 * multiple concurrent runners claim different rows without blocking or ever
 * grabbing the same one. Dueness is compared against the database clock (now())
 * so app/DB clock skew can never hide a just-enqueued job. Returns null when
 * nothing is due.
 */
export async function claimNext(runnerId: string): Promise<JobRow | null> {
  const result = await getPool().query<DbJobRow>(
    `with next as (
       select id from job_queue
       where status = 'queued' and run_at <= now()
       order by priority, run_at
       for update skip locked
       limit 1
     )
     update job_queue j
       set status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1, updated_at = now()
     from next
     where j.id = next.id
     returning j.*`,
    [runnerId],
  );

  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function completeJob(id: string, result: unknown): Promise<void> {
  await getPool().query(
    `update job_queue
     set status = 'succeeded', result = $2::jsonb, locked_at = null, locked_by = null, last_error = null, updated_at = now()
     where id = $1`,
    [id, JSON.stringify(result ?? null)],
  );
}

/**
 * Record a failed attempt and decide the job's fate: requeue with backoff while
 * attempts remain, otherwise mark it dead. `attempts` on the row already
 * reflects the try that just failed (incremented at claim time).
 */
export async function failJob(job: Pick<JobRow, "id" | "attempts" | "maxAttempts">, error: unknown, now = new Date()): Promise<void> {
  const { status, runAt } = nextAttemptState(job.attempts, job.maxAttempts, now);
  const message = error instanceof Error ? error.message : String(error);

  await getPool().query(
    `update job_queue
     set status = $2, run_at = coalesce($3, run_at), last_error = $4, locked_at = null, locked_by = null, updated_at = now()
     where id = $1`,
    [job.id, status, runAt, message.slice(0, 2000)],
  );
}

/**
 * Recover jobs stuck in `running` past `staleMs` (a runner crashed or was
 * killed mid-job). Each is treated as a failed attempt: requeued with backoff
 * or marked dead. Returns the number reclaimed.
 */
export async function reclaimStaleJobs(now = new Date(), staleMs = 30 * 60 * 1000): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs);
  // Runs in an explicit transaction: FOR UPDATE SKIP LOCKED only keeps rows
  // locked until commit, so via autocommit two concurrent reclaimers would
  // both select (and double-fail) the same jobs.
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const stale = await client.query<DbJobRow>(
      `select * from job_queue where status = 'running' and locked_at is not null and locked_at < $1 for update skip locked`,
      [cutoff],
    );

    for (const row of stale.rows) {
      const job = mapJob(row);
      const { status, runAt } = nextAttemptState(job.attempts, job.maxAttempts, now);

      await client.query(
        `update job_queue
         set status = $2, run_at = coalesce($3, run_at), last_error = $4, locked_at = null, locked_by = null, updated_at = now()
         where id = $1`,
        [job.id, status, runAt, `Reclaimed after running longer than ${Math.round(staleMs / 60000)}m`],
      );
    }

    await client.query("commit");

    return stale.rows.length;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getJob(id: string): Promise<JobRow | null> {
  const result = await getPool().query<DbJobRow>(`select * from job_queue where id = $1`, [id]);
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function listRecentJobs(limit = 8): Promise<JobRow[]> {
  const result = await getPool().query<DbJobRow>(
    `select * from job_queue order by created_at desc limit $1`,
    [limit],
  );

  return result.rows.map(mapJob);
}
