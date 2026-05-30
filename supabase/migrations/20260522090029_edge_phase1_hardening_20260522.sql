-- Oyi Edge Agent Phase 1 hardening: durable discovery, camera stream health, and edge visibility.

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
create index if not exists idx_facility_cameras_edge_node on facility_cameras(edge_node_id);
create index if not exists idx_facility_cameras_stream_status on facility_cameras(stream_status);

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

alter table if exists edge_nodes add column if not exists local_runtime_host text;
alter table if exists edge_nodes add column if not exists camera_count int not null default 0;
alter table if exists edge_nodes add column if not exists device_count int not null default 0;
alter table if exists edge_nodes add column if not exists queue_depth int not null default 0;
alter table if exists edge_nodes add column if not exists sync_status text not null default 'awaiting_edge_runtime';
alter table if exists edge_nodes add column if not exists error_count int not null default 0;
alter table if exists edge_nodes add column if not exists runtime_version text;
alter table if exists edge_nodes add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists edge_heartbeats add column if not exists local_runtime_host text;
alter table if exists edge_heartbeats add column if not exists camera_count int default 0;
alter table if exists edge_heartbeats add column if not exists device_count int default 0;
alter table if exists edge_heartbeats add column if not exists queue_depth int default 0;
alter table if exists edge_heartbeats add column if not exists sync_status text default 'awaiting_edge_runtime';
alter table if exists edge_heartbeats add column if not exists error_count int default 0;
alter table if exists edge_heartbeats add column if not exists runtime_version text;
alter table if exists edge_heartbeats add column if not exists metadata jsonb not null default '{}'::jsonb;;
