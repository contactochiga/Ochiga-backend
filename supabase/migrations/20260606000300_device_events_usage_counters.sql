begin;

create table if not exists device_events (
  id uuid default gen_random_uuid() primary key,
  device_id uuid references devices(id) on delete cascade,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  event_type text not null,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  source text not null default 'system',
  confidence_level text not null default 'unknown',
  actor_id uuid references users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  latency_ms integer,
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint device_events_confidence_check check (confidence_level in ('confirmed', 'probable', 'possible', 'unknown'))
);

create index if not exists idx_device_events_device_time on device_events(device_id, occurred_at desc);
create index if not exists idx_device_events_home_time on device_events(home_id, occurred_at desc);
create index if not exists idx_device_events_source_time on device_events(source, occurred_at desc);
create unique index if not exists idx_device_events_provider_event on device_events(provider_event_id) where provider_event_id is not null;

create table if not exists device_usage_counters (
  device_id uuid primary key references devices(id) on delete cascade,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  total_toggles integer not null default 0,
  on_count integer not null default 0,
  off_count integer not null default 0,
  app_control_count integer not null default 0,
  watch_control_count integer not null default 0,
  scene_control_count integer not null default 0,
  automation_control_count integer not null default 0,
  provider_report_count integer not null default 0,
  physical_possible_count integer not null default 0,
  offline_count integer not null default 0,
  online_count integer not null default 0,
  failure_count integer not null default 0,
  command_success_count integer not null default 0,
  command_failure_count integer not null default 0,
  last_used_at timestamptz,
  last_online_at timestamptz,
  last_offline_at timestamptz,
  last_source text,
  average_response_ms integer,
  stability_score integer,
  uptime_percent_24h numeric,
  uptime_percent_7d numeric,
  uptime_percent_30d numeric,
  average_daily_usage numeric,
  average_daily_toggles numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_device_usage_home on device_usage_counters(home_id);
create index if not exists idx_device_usage_last_used on device_usage_counters(last_used_at desc);

alter table if exists home_timeline add column if not exists category text;
alter table if exists home_timeline add column if not exists importance text default 'normal';

alter table if exists user_push_tokens add column if not exists provider text;
alter table if exists user_push_tokens add column if not exists environment text;
alter table if exists user_push_tokens add column if not exists app_bundle text;

commit;
