-- Keep a custom avatar (including explicit removal) separate from provider sync.
alter table app_user add column avatar_custom boolean not null default false;
alter table fantasy_team add column logo_url text;
