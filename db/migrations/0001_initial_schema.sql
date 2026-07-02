-- Open Fantasy Baseball initial PostgreSQL schema.
-- The schema favors explicit fantasy concepts over ORM-specific conventions.

create extension if not exists pgcrypto;

create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_identity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_subject)
);

create table oauth_client (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_user(id) on delete cascade,
  name text not null,
  client_id text not null unique,
  client_secret_hash text,
  redirect_uris text[] not null default '{}',
  allowed_scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table oauth_access_token (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  client_id uuid not null references oauth_client(id) on delete cascade,
  token_hash text not null unique,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table user_preference (
  user_id uuid primary key references app_user(id) on delete cascade,
  time_zone text not null default 'America/New_York',
  favorite_team_ids uuid[] not null default '{}',
  notification_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table push_subscription (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table league (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scoring_type text not null check (scoring_type in ('h2h-categories', 'h2h-points', 'roto')),
  season_year integer not null,
  commissioner_user_id uuid not null references app_user(id),
  status text not null default 'pre_draft' check (status in ('pre_draft', 'drafting', 'active', 'playoffs', 'complete', 'archived')),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table league_member (
  league_id uuid not null references league(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  role text not null default 'manager' check (role in ('commissioner', 'co_commissioner', 'manager')),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table fantasy_team (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  manager_user_id uuid not null references app_user(id),
  name text not null,
  abbreviation text,
  waiver_priority integer,
  faab_remaining numeric(8, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, name)
);

create table league_roster_slot (
  league_id uuid not null references league(id) on delete cascade,
  slot text not null,
  count integer not null check (count >= 0),
  primary key (league_id, slot)
);

create table league_stat_category (
  league_id uuid not null references league(id) on delete cascade,
  category text not null,
  side text not null check (side in ('hitting', 'pitching')),
  sort_order integer not null,
  points_weight numeric(8, 3),
  primary key (league_id, category)
);

create table mlb_team (
  id integer primary key,
  abbreviation text not null unique,
  name text not null,
  league text,
  division text
);

create table player (
  id uuid primary key default gen_random_uuid(),
  mlb_player_id integer unique,
  full_name text not null,
  bats text,
  throws text,
  status text not null default 'active',
  current_mlb_team_id integer references mlb_team(id),
  birth_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table player_position_eligibility (
  player_id uuid not null references player(id) on delete cascade,
  position text not null,
  source text not null default 'system',
  valid_from date not null,
  valid_to date,
  primary key (player_id, position, valid_from)
);

create table player_news (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references player(id) on delete cascade,
  source text not null,
  source_url text,
  headline text not null,
  summary text,
  published_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table player_stat_line (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references player(id) on delete cascade,
  stat_date date not null,
  game_pk integer,
  split text not null check (split in ('game', 'season', 'last_7', 'last_14', 'last_30', 'projection_ros')),
  stats jsonb not null,
  source text not null,
  collected_at timestamptz not null default now(),
  unique (player_id, stat_date, split, source)
);

create table scoring_period (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  label text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'final')),
  unique (league_id, label)
);

create table matchup (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  scoring_period_id uuid not null references scoring_period(id) on delete cascade,
  home_team_id uuid not null references fantasy_team(id) on delete cascade,
  away_team_id uuid not null references fantasy_team(id) on delete cascade,
  home_score numeric(10, 3) not null default 0,
  away_score numeric(10, 3) not null default 0,
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'final')),
  unique (scoring_period_id, home_team_id, away_team_id)
);

create table matchup_category_score (
  matchup_id uuid not null references matchup(id) on delete cascade,
  category text not null,
  home_value numeric(14, 4),
  away_value numeric(14, 4),
  home_result text check (home_result in ('win', 'loss', 'tie')),
  primary key (matchup_id, category)
);

create table roster_entry (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references fantasy_team(id) on delete cascade,
  player_id uuid not null references player(id) on delete restrict,
  acquired_at timestamptz not null default now(),
  dropped_at timestamptz,
  acquisition_type text not null default 'draft',
  unique (team_id, player_id, acquired_at)
);

create table lineup_entry (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references fantasy_team(id) on delete cascade,
  player_id uuid not null references player(id) on delete restrict,
  scoring_period_id uuid not null references scoring_period(id) on delete cascade,
  lineup_date date not null,
  slot text not null,
  locked_at timestamptz,
  unique (team_id, player_id, lineup_date)
);

create table fantasy_transaction (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  team_id uuid references fantasy_team(id) on delete set null,
  actor_user_id uuid references app_user(id) on delete set null,
  type text not null check (type in ('add', 'drop', 'trade', 'waiver', 'commissioner_edit', 'lineup_change')),
  status text not null default 'pending' check (status in ('pending', 'processed', 'rejected', 'canceled')),
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table waiver_claim (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  team_id uuid not null references fantasy_team(id) on delete cascade,
  add_player_id uuid not null references player(id) on delete restrict,
  drop_player_id uuid references player(id) on delete restrict,
  bid_amount numeric(8, 2),
  priority_at_claim integer,
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'canceled')),
  process_after timestamptz not null,
  created_at timestamptz not null default now()
);

create table trade_offer (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  proposing_team_id uuid not null references fantasy_team(id) on delete cascade,
  receiving_team_id uuid not null references fantasy_team(id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'canceled', 'vetoed', 'processed')),
  review_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table trade_offer_item (
  trade_offer_id uuid not null references trade_offer(id) on delete cascade,
  from_team_id uuid not null references fantasy_team(id) on delete cascade,
  player_id uuid not null references player(id) on delete restrict,
  primary key (trade_offer_id, from_team_id, player_id)
);

create table ingestion_run (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  job_type text not null,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_seen integer not null default 0,
  error_message text
);

create table background_job_run (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  league_id uuid references league(id) on delete cascade,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  details jsonb not null default '{}'::jsonb
);

create index idx_fantasy_team_league on fantasy_team(league_id);
create index idx_player_name on player using gin (to_tsvector('english', full_name));
create index idx_player_news_player_published on player_news(player_id, published_at desc);
create index idx_player_stat_line_lookup on player_stat_line(player_id, split, stat_date desc);
create index idx_roster_entry_team_active on roster_entry(team_id) where dropped_at is null;
create index idx_lineup_entry_team_date on lineup_entry(team_id, lineup_date);
create index idx_waiver_claim_processing on waiver_claim(league_id, process_after, status);
create index idx_transaction_league_created on fantasy_transaction(league_id, created_at desc);
