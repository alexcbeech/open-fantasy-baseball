-- Stable keyset pagination for the admin audit log. The id tie-breaker avoids
-- skipping rows when many events share the same occurred_at timestamp.
create index if not exists idx_audit_log_page
  on audit_log (occurred_at desc, id desc);
