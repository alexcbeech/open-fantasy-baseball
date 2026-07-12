-- Append-only audit trail of user and admin actions. actor_user_id is text,
-- not a uuid FK: bearer principals and sessions carry app_user uuids, but demo
-- mode uses a sentinel id, and audit rows must outlive account deletion.
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id text,
  actor_email text,
  action text not null,
  entity_type text,
  entity_id text,
  league_id uuid,
  team_id uuid,
  detail jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text
);

-- Admin viewer reads newest first; filters on action and actor.
create index idx_audit_log_occurred_at on audit_log (occurred_at desc);
create index idx_audit_log_action on audit_log (action, occurred_at desc);
create index idx_audit_log_actor_email on audit_log (actor_email, occurred_at desc);
create index idx_audit_log_league on audit_log (league_id, occurred_at desc) where league_id is not null;
