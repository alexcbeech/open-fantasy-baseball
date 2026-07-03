-- Player biographical detail surfaced in the Yahoo-style detail header.
alter table player add column if not exists jersey_number text;
