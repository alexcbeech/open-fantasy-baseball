-- Playoff seeding: teams that make the field keep their bracket seed for
-- re-seeded pairing and tiebreaks across rounds.

alter table fantasy_team add column if not exists playoff_seed integer;
