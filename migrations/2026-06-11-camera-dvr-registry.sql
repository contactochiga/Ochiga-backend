create table if not exists camera_dvrs (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  name text not null,
  brand text not null default 'generic_rtsp',
  model text,
  ip_address text not null,
  port int not null default 554,
  credential_ref text not null,
  channel_count int not null default 0,
  edge_node_id text,
  onvif_enabled boolean not null default false,
  rtsp_enabled boolean not null default true,
  status text not null default 'pending',
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_camera_dvrs_estate_ip unique (estate_id, ip_address)
);

create index if not exists idx_camera_dvrs_estate on camera_dvrs(estate_id);
create index if not exists idx_camera_dvrs_edge_node on camera_dvrs(edge_node_id);
create index if not exists idx_camera_dvrs_status on camera_dvrs(status);

alter table if exists facility_cameras add column if not exists privacy_scope text;
alter table if exists facility_cameras drop constraint if exists uq_facility_cameras_estate_ip;
create index if not exists idx_facility_cameras_privacy_scope on facility_cameras(privacy_scope);
create index if not exists idx_facility_cameras_estate_ip on facility_cameras(estate_id, ip);
create unique index if not exists uq_facility_cameras_estate_nvr_channel
  on facility_cameras(estate_id, nvr_id, channel)
  where nvr_id is not null and channel is not null;
