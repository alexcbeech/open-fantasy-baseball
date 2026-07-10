-- Waiver support: dropped players sit on waivers until the league's next
-- processing time (stored on the closing roster row), and a team may hold at
-- most one pending claim per player.

alter table roster_entry add column if not exists waiver_until timestamptz;

create index if not exists idx_roster_entry_waiver on roster_entry (league_id, player_id, waiver_until)
  where waiver_until is not null;

create unique index if not exists uniq_pending_waiver_claim
  on waiver_claim (team_id, add_player_id)
  where status = 'pending';
