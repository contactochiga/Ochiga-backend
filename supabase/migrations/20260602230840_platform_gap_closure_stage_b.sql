create extension if not exists "pgcrypto";

create table if not exists twin_models (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in ('glb','floorplan','estate_map','cad','other')),
  state text not null default 'uploaded' check (state in ('uploaded','processing','available','failed','pending_source')),
  version integer not null default 1,
  file_url text,
  storage_key text,
  metadata jsonb not null default '{}'::jsonb,
  assigned_scope text not null default 'estate' check (assigned_scope in ('estate','building','home','room','zone')),
  assigned_entity_id uuid,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists twin_entity_placements (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  entity_type text not null check (entity_type in ('building','home','room','device','camera','edge_node','maintenance','incident','utility','zone')),
  entity_id uuid not null,
  location_state text not null default 'location_pending' check (location_state in ('no_location','location_assigned','location_pending')),
  label text,
  building_id uuid,
  home_id uuid references homes(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  zone text,
  floor text,
  coordinates jsonb,
  metadata jsonb not null default '{}'::jsonb,
  assigned_by uuid references users(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estate_id, entity_type, entity_id)
);

create table if not exists utility_telemetry (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  edge_node_id uuid,
  utility_type text not null check (utility_type in ('power','water','network','environmental')),
  state text not null default 'awaiting_telemetry' check (state in ('live','degraded','offline','awaiting_telemetry','no_source_configured')),
  value numeric,
  unit text,
  severity text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists edge_node_history (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references estates(id) on delete cascade,
  edge_node_id uuid,
  node_id text,
  event_type text not null check (event_type in ('heartbeat','queue','sync','health','ownership','placement')),
  state text,
  queue_depth integer,
  device_count integer,
  runtime_version text,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists facility_incidents (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  title text not null,
  description text,
  incident_type text not null default 'operational',
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','assigned','investigating','resolved','closed')),
  assigned_to uuid references users(id) on delete set null,
  location jsonb,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists facility_incident_timeline (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references facility_incidents(id) on delete cascade,
  estate_id uuid references estates(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists camera_infrastructure (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  camera_id uuid not null,
  placement_id uuid references twin_entity_placements(id) on delete set null,
  zone text,
  area_owner text,
  infrastructure_relationship text,
  health_state text default 'awaiting_telemetry',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estate_id, camera_id)
);

create table if not exists camera_health_history (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references estates(id) on delete cascade,
  camera_id uuid not null,
  health_state text not null,
  stream_state text,
  event_type text,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_twin_models_estate on twin_models(estate_id, state, source_type);
create index if not exists idx_twin_entity_placements_estate on twin_entity_placements(estate_id, entity_type, location_state);
create index if not exists idx_twin_entity_placements_entity on twin_entity_placements(entity_type, entity_id);
create index if not exists idx_utility_telemetry_estate on utility_telemetry(estate_id, utility_type, observed_at desc);
create index if not exists idx_edge_node_history_estate on edge_node_history(estate_id, event_type, observed_at desc);
create index if not exists idx_facility_incidents_estate on facility_incidents(estate_id, status, severity, created_at desc);
create index if not exists idx_facility_incident_timeline_incident on facility_incident_timeline(incident_id, created_at desc);
create index if not exists idx_camera_infrastructure_estate on camera_infrastructure(estate_id, camera_id);
create index if not exists idx_camera_health_history_estate on camera_health_history(estate_id, camera_id, observed_at desc);

alter table twin_models enable row level security;
alter table twin_entity_placements enable row level security;
alter table utility_telemetry enable row level security;
alter table edge_node_history enable row level security;
alter table facility_incidents enable row level security;
alter table facility_incident_timeline enable row level security;
alter table camera_infrastructure enable row level security;
alter table camera_health_history enable row level security;
