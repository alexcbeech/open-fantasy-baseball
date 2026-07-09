-- Migration 0011 added roster_entry.league_id as a plain reference to league(id)
-- with no ON DELETE action. That FK blocks deleting a league (and anything that
-- cascades through it) even though the roster rows would otherwise be removed
-- via the team_id -> fantasy_team cascade. Re-create it with ON DELETE CASCADE
-- so a league (and its teams' roster entries) can be removed cleanly.

alter table roster_entry drop constraint if exists roster_entry_league_id_fkey;

alter table roster_entry
  add constraint roster_entry_league_id_fkey
  foreign key (league_id) references league(id) on delete cascade;
