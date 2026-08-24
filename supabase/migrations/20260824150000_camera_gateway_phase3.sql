-- Oyi Camera Gateway Phase 3
-- Additive command/candidate orchestration. Discovery candidates remain separate
-- from canonical facility_cameras until an authorized provisioning action.

alter table if exists public.discovered_devices
  add column if not exists discovery_fingerprint text,
  add column if not exists discovery_state text not null default 'discovered',
  add column if not exists discovery_command_id uuid,
  add column if not exists canonical_camera_id uuid references public.facility_cameras(id) on delete set null,
  add column if not exists home_id uuid references public.homes(id) on delete set null,
  add column if not exists capabilities jsonb not null default '{}'::jsonb,
  add column if not exists discovered_at timestamptz;

alter table if exists public.facility_cameras
  add column if not exists discovery_fingerprint text;

create unique index if not exists uq_discovered_devices_edge_fingerprint
  on public.discovered_devices(estate_id, edge_node_id, discovery_fingerprint)
  where discovery_fingerprint is not null;

create unique index if not exists uq_facility_cameras_estate_fingerprint
  on public.facility_cameras(estate_id, discovery_fingerprint)
  where discovery_fingerprint is not null;

create table if not exists public.edge_commands (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references public.estates(id) on delete cascade,
  home_id uuid references public.homes(id) on delete set null,
  edge_node_id text not null,
  command_type text not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  requested_by uuid references public.users(id) on delete set null,
  requested_surface text not null default 'facility',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint edge_commands_status_check check (status in ('pending','delivered','running','completed','failed','expired')),
  constraint edge_commands_surface_check check (requested_surface in ('facility','consumer','system'))
);

create index if not exists idx_edge_commands_node_status
  on public.edge_commands(estate_id, edge_node_id, status, created_at);

create index if not exists idx_edge_commands_expiry
  on public.edge_commands(expires_at)
  where status in ('pending','delivered','running');

alter table if exists public.edge_commands enable row level security;
revoke all on public.edge_commands from anon, authenticated;
revoke all on public.discovered_devices from anon, authenticated;

comment on table public.edge_commands is
  'Server-authoritative Edge command envelope. Edge identity claims commands by bound estate/node.';

comment on column public.discovered_devices.discovery_fingerprint is
  'Stable Edge-derived physical identity; never based on IP alone when stronger ONVIF identity exists.';
