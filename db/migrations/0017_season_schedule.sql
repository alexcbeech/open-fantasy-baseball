-- Season schedule support: scoring periods now know whether they are playoff
-- rounds. Regular-season weeks get round-robin matchups at generation time;
-- playoff periods are seeded with matchups when the prior round finalizes.

alter table scoring_period add column if not exists is_playoff boolean not null default false;
alter table scoring_period add column if not exists playoff_round integer;

create index if not exists idx_scoring_period_league_starts on scoring_period (league_id, starts_at);
