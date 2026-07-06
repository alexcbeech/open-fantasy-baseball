-- User-submitted feedback (feature ideas and issue reports) captured from a
-- global widget. user_email is stored denormalized because feedback can arrive
-- before an app_user row exists (or be resolved from a session email that has no
-- row yet); user_id links to the account when the email matches one. metadata
-- holds client context (page, viewport, theme, locale, auth id, ...).
create table feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'idea'
    check (category in ('idea', 'issue')),
  message text not null,
  page_path text,
  user_id uuid references app_user(id) on delete set null,
  user_email text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'new'
    check (status in ('new', 'reviewed', 'closed')),
  created_at timestamptz not null default now()
);

-- Admin viewer reads newest first.
create index idx_feedback_created_at on feedback (created_at desc);
