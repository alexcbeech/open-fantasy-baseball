-- Keep championship qualifiers and consolation placement brackets separate.
-- Existing playoff brackets stay fixed; consolation seeds are assigned only
-- when the first playoff round starts after this migration.
alter table fantasy_team add column if not exists consolation_seed integer;
alter table fantasy_team add column if not exists consolation_bracket integer;
alter table matchup add column if not exists is_consolation boolean not null default false;
