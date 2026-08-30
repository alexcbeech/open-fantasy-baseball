-- League Hub: commissioner announcements and a real trade deadline that the
-- trade workflow can enforce. Playoff dates continue to come from the season
-- schedule rather than duplicating those dates on the league row.

alter table league add column if not exists trade_deadline_at timestamptz;

create table if not exists league_announcement (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references league(id) on delete cascade,
  author_user_id uuid not null references app_user(id),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  is_pinned boolean not null default false,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists idx_league_announcement_feed
  on league_announcement (league_id, is_pinned desc, published_at desc)
  where archived_at is null;

-- The product presents one primary announcement at a time. Keeping that rule
-- in Postgres prevents concurrent commissioner requests from pinning two.
create unique index if not exists idx_league_announcement_one_pinned
  on league_announcement (league_id)
  where is_pinned and archived_at is null;
