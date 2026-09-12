-- Persist drafts and immutable delivery attempts independently of feedback triage.
create table feedback_reply (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references feedback(id) on delete cascade,
  recipient text not null,
  subject text not null check (length(subject) between 1 and 200),
  body text not null default '' check (length(body) <= 10000),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'unconfirmed')),
  revision integer not null default 1,
  author_email text not null,
  sender_email text,
  from_address text,
  reply_to text,
  html text,
  email_text text,
  close_feedback boolean not null default false,
  first_attempt_at timestamptz,
  attempt_at timestamptz,
  sent_at timestamptz,
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_feedback_reply_history on feedback_reply(feedback_id, created_at desc);
-- One shared draft avoids two admins unknowingly preparing separate replies.
create unique index idx_feedback_reply_draft on feedback_reply(feedback_id) where status = 'draft';
