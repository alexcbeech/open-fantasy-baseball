-- League invites: a commissioner emails someone a single-use join link.
-- Only the SHA-256 hash of the invite token is stored (same posture as
-- oauth_access_token); the raw token exists only in the emailed link and in
-- the create response shown once to the commissioner.

create table league_invite (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  invited_by_user_id uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references app_user(id)
);

create index idx_league_invite_league on league_invite(league_id);

-- One live (unaccepted) invite per email per league; re-inviting the same
-- address replaces the pending invite in application code, and this backstops
-- the race where two commissioners invite simultaneously.
create unique index idx_league_invite_pending_email
  on league_invite (league_id, lower(email))
  where accepted_at is null;
