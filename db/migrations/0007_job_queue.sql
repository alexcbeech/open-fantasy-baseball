-- Durable, Postgres-backed job queue. Domain processing jobs (waiver
-- resolution today; scoring/matchup/notification recomputes next) are enqueued
-- here and drained by a runner claiming rows with FOR UPDATE SKIP LOCKED. This
-- gives retries, backoff, dedup, and observability with no extra infra.
create table job_queue (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  dedup_key text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  -- Earliest time the job may run; also how scheduling and retry backoff are expressed.
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts > 0),
  priority integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot claim path: due, runnable jobs in run order.
create index idx_job_queue_claim on job_queue (priority, run_at) where status = 'queued';

-- At most one active job per dedup key, so a re-triggered workflow can't
-- double-enqueue the same run.
create unique index idx_job_queue_dedup_active on job_queue (dedup_key)
  where dedup_key is not null and status in ('queued', 'running');
