begin;

create table if not exists ochiga_intelligence_events (
  id uuid default gen_random_uuid() primary key
);

alter table if exists ochiga_intelligence_events add column if not exists actor_id text;
alter table if exists ochiga_intelligence_events add column if not exists agent_id text not null default 'oyi';
alter table if exists ochiga_intelligence_events add column if not exists surface text not null default 'api';
alter table if exists ochiga_intelligence_events add column if not exists estate_id uuid references estates(id) on delete set null;
alter table if exists ochiga_intelligence_events add column if not exists home_id uuid references homes(id) on delete set null;
alter table if exists ochiga_intelligence_events add column if not exists office_id text;
alter table if exists ochiga_intelligence_events add column if not exists camera_id uuid references facility_cameras(id) on delete set null;
alter table if exists ochiga_intelligence_events add column if not exists event_type text not null default 'intelligence.event';
alter table if exists ochiga_intelligence_events add column if not exists category text not null default 'operational';
alter table if exists ochiga_intelligence_events add column if not exists title text not null default 'Intelligence update';
alter table if exists ochiga_intelligence_events add column if not exists summary text not null default 'Intelligence update';
alter table if exists ochiga_intelligence_events add column if not exists confidence text not null default 'unknown';
alter table if exists ochiga_intelligence_events add column if not exists source text not null default 'intelligence_core';
alter table if exists ochiga_intelligence_events add column if not exists source_table text;
alter table if exists ochiga_intelligence_events add column if not exists source_event_id text;
alter table if exists ochiga_intelligence_events add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_intelligence_events add column if not exists occurred_at timestamptz not null default now();
alter table if exists ochiga_intelligence_events add column if not exists created_at timestamptz not null default now();

create index if not exists idx_ochiga_intelligence_events_time on ochiga_intelligence_events(occurred_at desc);
create index if not exists idx_ochiga_intelligence_events_agent_time on ochiga_intelligence_events(agent_id, occurred_at desc);
create index if not exists idx_ochiga_intelligence_events_estate_time on ochiga_intelligence_events(estate_id, occurred_at desc);
create index if not exists idx_ochiga_intelligence_events_home_time on ochiga_intelligence_events(home_id, occurred_at desc);
create index if not exists idx_ochiga_intelligence_events_camera_time on ochiga_intelligence_events(camera_id, occurred_at desc);
create index if not exists idx_ochiga_intelligence_events_category_time on ochiga_intelligence_events(category, occurred_at desc);
create unique index if not exists idx_ochiga_intelligence_events_source_unique on ochiga_intelligence_events(source_table, source_event_id) where source_table is not null and source_event_id is not null;

create table if not exists ochiga_memory_directory (
  id uuid default gen_random_uuid() primary key
);

alter table if exists ochiga_memory_directory add column if not exists scope text not null default 'system';
alter table if exists ochiga_memory_directory add column if not exists owner_key text not null default 'system';
alter table if exists ochiga_memory_directory add column if not exists agent_id text;
alter table if exists ochiga_memory_directory add column if not exists storage_table text not null default 'ochiga_intelligence_events';
alter table if exists ochiga_memory_directory add column if not exists storage_key text;
alter table if exists ochiga_memory_directory add column if not exists visibility text not null default 'private';
alter table if exists ochiga_memory_directory add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists ochiga_memory_directory add column if not exists created_at timestamptz not null default now();
alter table if exists ochiga_memory_directory add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_ochiga_memory_directory_unique on ochiga_memory_directory(scope, owner_key, storage_table, coalesce(storage_key, ''));
create index if not exists idx_ochiga_memory_directory_agent on ochiga_memory_directory(agent_id, scope);

alter table if exists ochiga_intelligence_events enable row level security;
alter table if exists ochiga_memory_directory enable row level security;

commit;
