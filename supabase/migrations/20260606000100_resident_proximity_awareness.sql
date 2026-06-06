begin;

create table if not exists resident_proximity_settings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  enabled boolean not null default false,
  radius_meters integer not null default 100,
  home_lat numeric,
  home_lng numeric,
  estate_lat numeric,
  estate_lng numeric,
  last_state text,
  last_notification_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resident_proximity_radius_check check (radius_meters in (20, 100, 500, 1000)),
  constraint resident_proximity_state_check check (last_state is null or last_state in ('near_home', 'leaving_home', 'away', 'approaching_estate'))
);

create unique index if not exists idx_resident_proximity_user_home
  on resident_proximity_settings(user_id, home_id);

create index if not exists idx_resident_proximity_user
  on resident_proximity_settings(user_id);

create index if not exists idx_resident_proximity_home
  on resident_proximity_settings(home_id);

commit;
