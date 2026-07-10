-- Trade proposals and league review votes.
--
-- A proposal moves offered_player_ids from the proposing team to the receiving
-- team and requested_player_ids the other way; each side may also drop players
-- when the deal would otherwise overflow their roster. Lifecycle:
--   proposed -> accepted -> processed          (review window elapsed)
--   proposed -> declined | withdrawn | vetoed
--   accepted -> vetoed | voted_down | failed   (failed = rosters changed and
--                                               the swap no longer fits)
-- The processed swap is also written to fantasy_transaction (type 'trade')
-- for the league's audit trail.

create table trade_proposal (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  from_team_id uuid not null references fantasy_team(id) on delete cascade,
  to_team_id uuid not null references fantasy_team(id) on delete cascade,
  offered_player_ids uuid[] not null,
  requested_player_ids uuid[] not null,
  from_drop_player_ids uuid[] not null default '{}',
  to_drop_player_ids uuid[] not null default '{}',
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'processed', 'declined', 'withdrawn', 'vetoed', 'voted_down', 'failed')),
  review_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (from_team_id <> to_team_id),
  check (cardinality(offered_player_ids) > 0),
  check (cardinality(requested_player_ids) > 0)
);

create index idx_trade_proposal_league on trade_proposal (league_id, created_at desc);
create index idx_trade_proposal_due on trade_proposal (status, review_ends_at);

-- One protest vote per team per trade; enough votes reject the trade in
-- league-vote review mode. Teams in the trade cannot vote.
create table trade_vote (
  trade_id uuid not null references trade_proposal(id) on delete cascade,
  team_id uuid not null references fantasy_team(id) on delete cascade,
  voter_user_id uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (trade_id, team_id)
);
