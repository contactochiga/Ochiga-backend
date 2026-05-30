create extension if not exists "pgcrypto";

create table if not exists estate_buildings (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  building_ref text not null,
  name text not null,
  block text,
  floors int,
  unit_count int default 0,
  building_type text default 'residential_block',
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_estate_buildings_ref unique (estate_id, building_ref)
);
create index if not exists idx_estate_buildings_estate on estate_buildings(estate_id);

create table if not exists estate_zones (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  zone_ref text not null,
  name text not null,
  zone_type text not null,
  parent_zone_ref text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_estate_zones_ref unique (estate_id, zone_ref)
);
create index if not exists idx_estate_zones_estate on estate_zones(estate_id);
create index if not exists idx_estate_zones_type on estate_zones(zone_type);

create table if not exists access_points (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  zone_id uuid references estate_zones(id) on delete set null,
  access_point_ref text not null,
  name text not null,
  access_type text not null default 'gate',
  location text,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_access_points_ref unique (estate_id, access_point_ref)
);
create index if not exists idx_access_points_estate on access_points(estate_id);
create index if not exists idx_access_points_zone on access_points(zone_id);

alter table if exists facility_cameras add column if not exists zone_id uuid references estate_zones(id) on delete set null;
alter table if exists facility_cameras add column if not exists camera_id text;
alter table if exists facility_cameras add column if not exists location text;
alter table if exists facility_cameras add column if not exists ip text;
alter table if exists facility_cameras add column if not exists onvif_port int;
alter table if exists facility_cameras add column if not exists dvr_nvr_ref text;
alter table if exists facility_cameras add column if not exists stream_protocol text default 'rtsp';
alter table if exists facility_cameras add column if not exists rtsp_url text;
alter table if exists facility_cameras add column if not exists edge_hls_url text;
alter table if exists facility_cameras add column if not exists onvif_supported boolean default false;
alter table if exists facility_cameras add column if not exists ai_enabled boolean default false;
alter table if exists facility_cameras add column if not exists status text default 'pending';
alter table if exists facility_cameras add column if not exists last_seen_at timestamptz;
alter table if exists facility_cameras add column if not exists health_status text default 'pending_stream_details';
alter table if exists facility_cameras add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists facility_cameras add column if not exists created_by uuid references users(id) on delete set null;
alter table if exists facility_cameras add column if not exists updated_at timestamptz not null default now();
alter table if exists facility_cameras add column if not exists edge_node_id text;
alter table if exists facility_cameras add column if not exists provider text default 'rtsp';
alter table if exists facility_cameras add column if not exists nvr_id text;
alter table if exists facility_cameras add column if not exists channel text;
alter table if exists facility_cameras add column if not exists rtsp_path_template text;
alter table if exists facility_cameras add column if not exists stream_status text default 'pending';
alter table if exists facility_cameras add column if not exists hls_url text;
alter table if exists facility_cameras add column if not exists credential_ref text;
alter table if exists facility_cameras add column if not exists last_health_check_at timestamptz;
alter table if exists facility_cameras add column if not exists last_success_at timestamptz;
alter table if exists facility_cameras add column if not exists last_failure_at timestamptz;
alter table if exists facility_cameras add column if not exists latency_ms int;
alter table if exists facility_cameras add column if not exists reconnect_count int not null default 0;
alter table if exists facility_cameras add column if not exists provider_error text;
alter table if exists facility_cameras add column if not exists error_message text;
create index if not exists idx_facility_cameras_estate on facility_cameras(estate_id);
create index if not exists idx_facility_cameras_zone on facility_cameras(zone_id);
create index if not exists idx_facility_cameras_status on facility_cameras(status);
create index if not exists idx_facility_cameras_edge_node on facility_cameras(edge_node_id);
create index if not exists idx_facility_cameras_stream_status on facility_cameras(stream_status);

create table if not exists edge_nodes (
  id uuid default gen_random_uuid() primary key,
  edge_node_id text not null,
  estate_id uuid not null references estates(id) on delete cascade,
  name text,
  heartbeat_status text not null default 'pending',
  last_seen_at timestamptz,
  local_runtime_host text,
  camera_count int not null default 0,
  device_count int not null default 0,
  queue_depth int not null default 0,
  sync_status text not null default 'awaiting_edge_runtime',
  error_count int not null default 0,
  runtime_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_edge_nodes_estate_node unique (estate_id, edge_node_id)
);
create index if not exists idx_edge_nodes_estate on edge_nodes(estate_id);
create index if not exists idx_edge_nodes_status on edge_nodes(heartbeat_status);

create table if not exists edge_heartbeats (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  edge_node_id text not null,
  heartbeat_status text not null default 'pending',
  local_runtime_host text,
  camera_count int default 0,
  device_count int default 0,
  queue_depth int default 0,
  sync_status text default 'awaiting_edge_runtime',
  error_count int default 0,
  runtime_version text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_edge_heartbeats_estate_received on edge_heartbeats(estate_id, received_at desc);
create index if not exists idx_edge_heartbeats_node_received on edge_heartbeats(edge_node_id, received_at desc);

create table if not exists utility_events (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete set null,
  device_id uuid references devices(id) on delete set null,
  utility_type text not null,
  event_type text not null,
  value numeric,
  unit text,
  status text not null default 'recorded',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_utility_events_estate_created on utility_events(estate_id, created_at desc);
create index if not exists idx_utility_events_type on utility_events(utility_type, event_type);

create table if not exists incidents (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete set null,
  zone_id uuid references estate_zones(id) on delete set null,
  title text not null,
  incident_type text not null default 'operational',
  severity text not null default 'medium',
  status text not null default 'open',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_incidents_estate_created on incidents(estate_id, created_at desc);
create index if not exists idx_incidents_status on incidents(status);

create table if not exists deployment_milestones (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid references estates(id) on delete cascade,
  milestone_type text not null,
  title text not null,
  status text not null default 'recorded',
  actor_id uuid references users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_deployment_milestones_estate_created on deployment_milestones(estate_id, created_at desc);
create index if not exists idx_deployment_milestones_type on deployment_milestones(milestone_type);

create table if not exists discovered_devices (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  edge_node_id text not null,
  external_id text not null,
  provider text,
  category text,
  name text,
  ip text,
  status text not null default 'pending',
  credential_ref text,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_discovered_devices_edge_external unique (estate_id, edge_node_id, external_id)
);
create index if not exists idx_discovered_devices_estate_seen on discovered_devices(estate_id, last_seen_at desc);
create index if not exists idx_discovered_devices_edge on discovered_devices(edge_node_id);
create index if not exists idx_discovered_devices_category on discovered_devices(category);

alter table if exists devices add column if not exists category text;
alter table if exists devices add column if not exists provider text;
alter table if exists devices add column if not exists adapter text;
alter table if exists devices add column if not exists online boolean default false;
alter table if exists devices add column if not exists capabilities jsonb not null default '[]'::jsonb;
alter table if exists devices add column if not exists protocols jsonb not null default '[]'::jsonb;
alter table if exists devices add column if not exists edge_node_id text;
alter table if exists devices add column if not exists location text;
alter table if exists devices add column if not exists last_seen_at timestamptz;
alter table if exists devices add column if not exists last_event_at timestamptz;
alter table if exists devices add column if not exists sync_state text default 'pending_integration';
update devices set adapter = coalesce(adapter, vendor, provider, 'unknown') where adapter is null;
create unique index if not exists uq_devices_estate_adapter_external on devices(estate_id, adapter, external_id);
create index if not exists idx_devices_category on devices(category);
create index if not exists idx_devices_edge_node on devices(edge_node_id);;
