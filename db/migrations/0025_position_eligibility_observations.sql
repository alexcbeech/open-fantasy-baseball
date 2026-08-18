alter table player_position_eligibility
  add column if not exists qualification_method text not null default 'legacy',
  add column if not exists last_qualified_season integer,
  add column if not exists last_roster_confirmed_at date;

alter table player_position_eligibility
  drop constraint if exists player_position_eligibility_qualification_method_check;

alter table player_position_eligibility
  add constraint player_position_eligibility_qualification_method_check
  check (qualification_method in ('legacy', 'roster', 'fielding', 'pitching', 'pitching-fallback', 'manual'));

create table player_position_observation (
  player_id uuid not null references player(id) on delete cascade,
  season_year integer not null,
  position text not null,
  games_started integer not null default 0 check (games_started >= 0),
  appearances integer not null default 0 check (appearances >= 0),
  source text not null,
  observed_at timestamptz not null default now(),
  primary key (player_id, season_year, position, source)
);

create table player_season_appearance (
  player_id uuid not null references player(id) on delete cascade,
  season_year integer not null,
  games_played integer not null default 0 check (games_played >= 0),
  source text not null,
  observed_at timestamptz not null default now(),
  primary key (player_id, season_year, source)
);

create index idx_player_position_observation_season
  on player_position_observation (season_year, position);
