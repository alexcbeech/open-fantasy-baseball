-- Real-world roster ownership (percent of fantasy leagues rostering the player)
-- from the external ADP feed. The prior "Rostered %" was OFB-internal ownership
-- across this app's own teams, which reads far too low for star players.
alter table player_adp add column if not exists rostered_percent numeric;
