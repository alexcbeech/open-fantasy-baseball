-- Future full-roster snapshots must not resurrect players after roster changes.
-- Discard plans on acquisitions/departures; historical/current snapshots remain.
create function reset_future_lineups_on_roster_change() returns trigger
language plpgsql as $$
declare
  affected_team uuid;
begin
  for affected_team in
    select distinct team_id from (
      select case when TG_OP <> 'INSERT' then OLD.team_id end as team_id
      union all
      select case when TG_OP <> 'DELETE' then NEW.team_id end
    ) teams where team_id is not null order by team_id
  loop
    perform pg_advisory_xact_lock(hashtext(affected_team::text));
    delete from lineup_entry where team_id = affected_team
      and lineup_date > (now() at time zone 'America/New_York')::date;
  end loop;
  return null;
end;
$$;

create trigger roster_change_resets_future_lineups
after insert or delete or update of team_id, player_id, dropped_at on roster_entry
for each row execute function reset_future_lineups_on_roster_change();
