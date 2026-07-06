-- Link a feedback row to the GitHub issue an admin promotes it into. PII
-- (user_email, user_agent, metadata) stays in the database; only a scrubbed
-- message + page path are sent to the (public) issue.
alter table feedback
  add column github_issue_number integer,
  add column github_issue_url text;
