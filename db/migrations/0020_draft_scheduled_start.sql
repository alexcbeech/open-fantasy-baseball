-- Scheduled draft starts (issue #94): a commissioner can set a future start
-- time; the draft auto-starts (filling open seats with bots) when it passes.
alter table draft add column if not exists scheduled_start_at timestamptz;
