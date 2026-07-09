-- Per-team draft queue and per-team auto-draft opt-in.
--
-- draft_queue: an ordered wishlist per team. When a team is auto-picked (clock
-- expired, or auto-draft on), the first still-available queued player is taken
-- before falling back to best-available. Drafted players are removed from every
-- team's queue.

create table draft_queue (
  draft_id uuid not null references draft(id) on delete cascade,
  team_id uuid not null references fantasy_team(id) on delete cascade,
  player_id uuid not null references player(id) on delete cascade,
  priority integer not null,
  created_at timestamptz not null default now(),
  primary key (draft_id, team_id, player_id)
);

create index idx_draft_queue_order on draft_queue (draft_id, team_id, priority);

-- auto_pick: when true, this team's turns are taken automatically (from its
-- queue, else best-available) without waiting for the clock. Bots pick on their
-- own short clock and don't need this.
alter table draft_order add column if not exists auto_pick boolean not null default false;
