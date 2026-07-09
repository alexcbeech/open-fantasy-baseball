-- Remove the 'auction' draft type. It was never implemented — auction leagues
-- silently ran as a linear pick draft — so the setting promised a format the
-- app does not deliver. Any existing auction drafts fall back to 'snake' (the
-- default), then the check constraint is narrowed to the supported types.

update draft set draft_type = 'snake' where draft_type = 'auction';

alter table draft drop constraint if exists draft_draft_type_check;

alter table draft
  add constraint draft_draft_type_check
  check (draft_type in ('snake', 'offline'));
