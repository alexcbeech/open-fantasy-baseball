-- One external AI manager per bot. Credentials only authorize the bot MCP endpoint.
create table ai_bot_manager (
  team_id uuid primary key references fantasy_team(id) on delete cascade,
  model text not null default '' check (length(model) <= 120),
  strategy text not null default '' check (length(strategy) <= 4000),
  enabled boolean not null default false,
  allow_trades boolean not null default false,
  token_hash text unique,
  token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- A durable receipt prevents a network retry from repeating an acquisition or offer.
-- Pending receipts are deliberately not replayed after a crash: inspect state first.
create table ai_bot_decision (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references ai_bot_manager(team_id) on delete cascade,
  request_id uuid not null,
  model text not null,
  reason text not null,
  command jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'uncertain')),
  result jsonb,
  created_at timestamptz not null default now(),
  unique (team_id, request_id)
);
create index ai_bot_decision_recent on ai_bot_decision(team_id, created_at desc);
