-- Forward adoption of the omitted migrations/2026-06-11-camera-dvr-registry.sql
-- table contract. Does not rewrite historical camera uniqueness or health.
begin;
create table if not exists public.camera_dvrs (
 id uuid primary key default gen_random_uuid(),
 estate_id uuid not null references public.estates(id) on delete cascade,
 name text not null, brand text not null default 'generic_rtsp', model text,
 ip_address text not null, port int not null default 554, credential_ref text not null,
 channel_count int not null default 0, edge_node_id text,
 onvif_enabled boolean not null default false, rtsp_enabled boolean not null default true,
 status text not null default 'pending', last_seen_at timestamptz,
 metadata jsonb not null default '{}'::jsonb,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint uq_camera_dvrs_estate_ip unique(estate_id,ip_address)
);
create index if not exists idx_camera_dvrs_estate on public.camera_dvrs(estate_id);
create index if not exists idx_camera_dvrs_edge_node on public.camera_dvrs(edge_node_id);
create index if not exists idx_camera_dvrs_status on public.camera_dvrs(status);
alter table public.camera_dvrs enable row level security;
revoke all on public.camera_dvrs from public,anon,authenticated;
grant select,insert,update,delete on public.camera_dvrs to service_role;
commit;
