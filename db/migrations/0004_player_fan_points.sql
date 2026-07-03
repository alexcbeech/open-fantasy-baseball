-- Season fantasy-points value used for the player rank in the detail card.
alter table player add column if not exists season_fan_points numeric;
create index if not exists idx_player_season_fan_points on player (season_fan_points desc);
