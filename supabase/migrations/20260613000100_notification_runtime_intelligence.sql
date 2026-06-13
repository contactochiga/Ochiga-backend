begin;

create table if not exists user_notification_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  category text not null,
  push_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  critical_only boolean not null default false,
  digest_mode boolean not null default false,
  cooldown_minutes integer not null default 30,
  quiet_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_notification_preferences_category_check check (category in ('security','visitors','maintenance','services','wallet','proximity','devices','automation','community','intelligence')),
  constraint user_notification_preferences_cooldown_check check (cooldown_minutes >= 0 and cooldown_minutes <= 1440),
  unique(user_id, category)
);

create index if not exists idx_user_notification_preferences_user on user_notification_preferences(user_id);

create table if not exists notification_decisions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  notification_key text not null,
  category text not null,
  decision text not null,
  title text,
  reason text,
  created_at timestamptz not null default now(),
  constraint notification_decisions_decision_check check (decision in ('activity_only','in_app','push','critical_push','digest','suppressed'))
);

create index if not exists idx_notification_decisions_user_key_time on notification_decisions(user_id, notification_key, created_at desc);
create index if not exists idx_notification_decisions_scope_time on notification_decisions(estate_id, home_id, created_at desc);

create table if not exists device_runtime_sessions (
  id uuid default gen_random_uuid() primary key,
  device_id uuid not null references devices(id) on delete cascade,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  source text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_device_runtime_device_time on device_runtime_sessions(device_id, started_at desc);
create index if not exists idx_device_runtime_home_time on device_runtime_sessions(home_id, started_at desc);
create index if not exists idx_device_runtime_open on device_runtime_sessions(device_id) where ended_at is null;

alter table if exists resident_proximity_settings add column if not exists last_distance numeric;
alter table if exists resident_proximity_settings add column if not exists last_direction text;
alter table if exists resident_proximity_settings add column if not exists last_notified_state text;
alter table if exists resident_proximity_settings add column if not exists session_id text;
alter table if exists resident_proximity_settings add column if not exists last_event_at timestamptz;

alter table if exists resident_proximity_settings drop constraint if exists resident_proximity_state_check;
alter table if exists resident_proximity_settings add constraint resident_proximity_state_check
  check (last_state is null or last_state in ('unknown','home','near_home','leaving_home','away','returning','approaching_estate'));

alter table if exists notifications add column if not exists home_id uuid references homes(id) on delete set null;
alter table if exists notifications add column if not exists delivery_channel text;
alter table if exists notifications add column if not exists notification_key text;
create index if not exists idx_notifications_home_time on notifications(home_id, created_at desc);
create index if not exists idx_notifications_key_user on notifications(user_id, notification_key, created_at desc) where notification_key is not null;

commit;
