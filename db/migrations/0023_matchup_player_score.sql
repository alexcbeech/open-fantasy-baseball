create table if not exists matchup_player_score (
  matchup_id uuid not null references matchup(id) on delete cascade,
  team_id uuid not null references fantasy_team(id) on delete cascade,
  player_id uuid not null references player(id) on delete cascade,
  fantasy_points numeric(10, 1) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (matchup_id, team_id, player_id)
);

create index if not exists idx_matchup_player_score_team
  on matchup_player_score (matchup_id, team_id);
