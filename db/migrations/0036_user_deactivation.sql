-- Preserve account identity/history while disabling access and deliveries.
alter table app_user
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references app_user(id),
  add column deactivation_reason text,
  add column sessions_valid_after timestamptz,
  add column auth_sync_pending boolean not null default false,
  add column account_revision integer not null default 0;
create index app_user_email_lower on app_user(lower(email));

alter table feedback_reply drop constraint feedback_reply_status_check;
alter table feedback_reply add constraint feedback_reply_status_check
  check (status in ('draft', 'sending', 'sent', 'unconfirmed', 'canceled'));
