-- A player may only be actively rostered by one team per league. The add/drop
-- and waiver paths both check availability before inserting, but two
-- concurrent transactions can pass that check together (READ COMMITTED), so
-- exclusivity must live in the database.
--
-- roster_entry has no league_id, and a partial unique index cannot join
-- through fantasy_team, so denormalize it with a trigger that fills it from
-- the team on insert. Existing writers don't need to change their INSERTs.

alter table roster_entry add column if not exists league_id uuid references league(id);

create or replace function set_roster_entry_league_id() returns trigger as $$
begin
  if new.league_id is null then
    select league_id into new.league_id from fantasy_team where id = new.team_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists roster_entry_league_id on roster_entry;
create trigger roster_entry_league_id
  before insert on roster_entry
  for each row execute function set_roster_entry_league_id();

update roster_entry re
set league_id = ft.league_id
from fantasy_team ft
where ft.id = re.team_id and re.league_id is null;

-- If this index fails to create, the data already contains a player on two
-- rosters in one league; resolve the duplicates and re-run the migration.
create unique index if not exists idx_roster_entry_active_player_per_league
  on roster_entry (league_id, player_id)
  where dropped_at is null;
