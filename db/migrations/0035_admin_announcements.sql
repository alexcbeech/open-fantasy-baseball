create table admin_announcement (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '', body text not null default '',
  button_label text not null default '', button_url text not null default '',
  revision integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'queued')),
  author text not null, sender text,
  from_address text, reply_to text, html text, email_text text,
  created_at timestamptz not null default now(), queued_at timestamptz
);
create table admin_announcement_recipient (
  announcement_id uuid not null references admin_announcement(id),
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'accepted', 'unconfirmed', 'blocked')),
  first_attempt_at timestamptz, attempt_at timestamptz, accepted_at timestamptz,
  provider_id text,
  primary key (announcement_id, email)
);
create index admin_announcement_created on admin_announcement(created_at desc);
create index admin_announcement_pending on admin_announcement_recipient(announcement_id, status);
