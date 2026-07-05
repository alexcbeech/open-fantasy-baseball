-- Durable notification outbox. Producers (waiver resolution, draft turns, ...)
-- insert a row inside their own transaction; the send_notifications job drains
-- pending rows and delivers them via Web Push, decoupling push latency and
-- flakiness from the domain write.
create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  url text,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Hot path: undelivered notifications, oldest first.
create index idx_notification_outbox_pending on notification_outbox (created_at) where status = 'pending';
