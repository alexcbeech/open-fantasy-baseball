create table mlb_game (
  game_pk integer primary key,
  game_date timestamptz not null,
  official_date date,
  status text,
  detailed_state text,
  abstract_game_state text,
  home_mlb_team_id integer references mlb_team(id),
  away_mlb_team_id integer references mlb_team(id),
  home_probable_pitcher_player_id uuid references player(id) on delete set null,
  away_probable_pitcher_player_id uuid references player(id) on delete set null,
  venue_name text,
  updated_at timestamptz not null default now()
);

create index idx_mlb_game_date on mlb_game(game_date);
create index idx_mlb_game_home_team on mlb_game(home_mlb_team_id, game_date);
create index idx_mlb_game_away_team on mlb_game(away_mlb_team_id, game_date);
