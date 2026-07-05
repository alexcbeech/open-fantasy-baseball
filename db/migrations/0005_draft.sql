-- Draft feature: draft state, pick order, pick history, bot teams, and external ADP.

-- Bot teams are flagged on fantasy_team; all bot teams are owned by one
-- sentinel app_user because fantasy_team.manager_user_id is NOT NULL.
alter table fantasy_team add column if not exists is_bot boolean not null default false;

insert into app_user (email, display_name)
values ('bots@ofb.internal', 'OFB Bot')
on conflict (email) do nothing;

create table if not exists draft (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references league(id) on delete cascade,
  draft_type text not null default 'snake' check (draft_type in ('snake', 'auction', 'offline')),
  status text not null default 'setup' check (status in ('setup', 'in_progress', 'paused', 'complete')),
  pick_seconds integer not null default 60 check (pick_seconds between 15 and 300),
  bot_pick_seconds integer not null default 5 check (bot_pick_seconds between 1 and 30),
  rounds integer not null check (rounds > 0),
  current_overall_pick integer not null default 1,
  -- Null unless status is in_progress; the clock is server-authoritative.
  current_pick_deadline timestamptz,
  -- Clock remainder captured when pausing so resume restores the same time left.
  paused_remaining_seconds numeric,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists draft_order (
  draft_id uuid not null references draft(id) on delete cascade,
  -- 1..teamCount; the round-1 order. Later rounds derive from the order strategy.
  position integer not null check (position > 0),
  team_id uuid not null references fantasy_team(id) on delete cascade,
  primary key (draft_id, position),
  unique (draft_id, team_id)
);

create table if not exists draft_pick (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references draft(id) on delete cascade,
  overall_pick integer not null check (overall_pick > 0),
  round integer not null check (round > 0),
  pick_in_round integer not null check (pick_in_round > 0),
  team_id uuid not null references fantasy_team(id),
  player_id uuid not null references player(id),
  made_by text not null default 'human' check (made_by in ('human', 'auto', 'bot')),
  created_at timestamptz not null default now(),
  unique (draft_id, overall_pick),
  -- DB-level guard: a player can only be drafted once per draft.
  unique (draft_id, player_id)
);

create index if not exists idx_draft_pick_team on draft_pick(draft_id, team_id);

-- External ADP lives in its own table (not player_stat_line): ADP is not a
-- stat split, and a single row per player with source attribution keeps the
-- draft-board ordering query a simple join.
create table if not exists player_adp (
  player_id uuid primary key references player(id) on delete cascade,
  adp numeric,
  adp_rank integer not null,
  source text not null,
  espn_player_id integer,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_player_adp_rank on player_adp(adp_rank);
