begin;

create table if not exists resident_memory (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  memory_type text not null,
  memory_key text not null,
  memory_value jsonb not null default '{}'::jsonb,
  weight integer not null default 1,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_resident_memory_user_home_type_key
  on resident_memory(user_id, home_id, memory_type, memory_key);

create index if not exists idx_resident_memory_user_type
  on resident_memory(user_id, memory_type, last_seen_at desc);

create table if not exists home_timeline (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  source text not null,
  event_type text not null,
  title text not null,
  summary text,
  severity text not null default 'info',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_home_timeline_user_time
  on home_timeline(user_id, occurred_at desc);

create index if not exists idx_home_timeline_home_time
  on home_timeline(home_id, occurred_at desc);

commit;
