begin;

create table if not exists ochiga_intelligence_events (
  id uuid default gen_random_uuid() primary key,
  actor_id text,
  agent_id text not null,
  surface text not null,
  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  office_id text,
  camera_id uuid references facility_cameras(id) on delete set null,
  event_type text not null,
  category text not null,
  title text not null,
  summary text not null,
  confidence text not null default 'unknown',
  source text not null,
  source_table text,
  source_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ochiga_intelligence_events_confidence_check check (confidence in ('confirmed', 'probable', 'possible', 'unknown')),
  constraint ochiga_intelligence_events_category_check check (category in ('operational', 'security', 'maintenance', 'visitor', 'community', 'marketing', 'sales', 'camera', 'edge', 'system'))
);

create index if not exists idx_ochiga_intelligence_events_time
  on ochiga_intelligence_events(occurred_at desc);

create index if not exists idx_ochiga_intelligence_events_agent_time
  on ochiga_intelligence_events(agent_id, occurred_at desc);

create index if not exists idx_ochiga_intelligence_events_estate_time
  on ochiga_intelligence_events(estate_id, occurred_at desc);

create index if not exists idx_ochiga_intelligence_events_home_time
  on ochiga_intelligence_events(home_id, occurred_at desc);

create index if not exists idx_ochiga_intelligence_events_camera_time
  on ochiga_intelligence_events(camera_id, occurred_at desc);

create index if not exists idx_ochiga_intelligence_events_category_time
  on ochiga_intelligence_events(category, occurred_at desc);

create unique index if not exists idx_ochiga_intelligence_events_source_unique
  on ochiga_intelligence_events(source_table, source_event_id)
  where source_table is not null and source_event_id is not null;

create table if not exists ochiga_memory_directory (
  id uuid default gen_random_uuid() primary key,
  scope text not null,
  owner_key text not null,
  agent_id text,
  storage_table text not null,
  storage_key text,
  visibility text not null default 'private',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ochiga_memory_directory_scope_check check (scope in ('resident', 'lead', 'estate', 'facility', 'camera', 'edge', 'office')),
  constraint ochiga_memory_directory_visibility_check check (visibility in ('private', 'scoped', 'shared', 'system'))
);

create unique index if not exists idx_ochiga_memory_directory_unique
  on ochiga_memory_directory(scope, owner_key, storage_table, coalesce(storage_key, ''));

create index if not exists idx_ochiga_memory_directory_agent
  on ochiga_memory_directory(agent_id, scope);

commit;
