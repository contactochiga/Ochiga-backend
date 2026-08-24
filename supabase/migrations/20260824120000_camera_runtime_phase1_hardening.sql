-- Oyi Camera Intelligence Runtime Phase 1
-- Additive canonical identity, event-time, and server-only table hardening.

alter table if exists public.camera_events
  add column if not exists source_timestamp timestamptz;

create index if not exists idx_camera_events_source_timestamp
  on public.camera_events(camera_id, source_timestamp desc)
  where source_timestamp is not null;

-- Existing rows are preserved. NOT VALID skips ambiguous legacy projections while
-- enforcing canonical facility_cameras identity for every new/updated row.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'camera_infrastructure_canonical_camera_fk') then
    alter table public.camera_infrastructure
      add constraint camera_infrastructure_canonical_camera_fk
      foreign key (camera_id) references public.facility_cameras(id) on delete cascade not valid;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'camera_health_history_canonical_camera_fk') then
    alter table public.camera_health_history
      add constraint camera_health_history_canonical_camera_fk
      foreign key (camera_id) references public.facility_cameras(id) on delete cascade not valid;
  end if;
end $$;

create or replace view public.camera_infrastructure_unresolved_legacy as
select projection.id, projection.estate_id, projection.camera_id, projection.created_at
from public.camera_infrastructure projection
left join public.facility_cameras camera on camera.id = projection.camera_id and camera.estate_id = projection.estate_id
where camera.id is null;

alter table if exists public.facility_cameras enable row level security;
alter table if exists public.camera_events enable row level security;
alter table if exists public.camera_ai_profiles enable row level security;
alter table if exists public.camera_dvrs enable row level security;
alter table if exists public.camera_infrastructure enable row level security;
alter table if exists public.camera_health_history enable row level security;
alter table if exists public.edge_nodes enable row level security;
alter table if exists public.edge_heartbeats enable row level security;
alter table if exists public.discovered_devices enable row level security;

-- These operational tables are server-authoritative. The service role bypasses
-- RLS; authenticated browser clients receive no direct table policy and must use
-- the audited Backend APIs, where estate/home/RBAC checks are applied.
revoke all on public.facility_cameras, public.camera_events, public.camera_ai_profiles,
  public.camera_dvrs, public.camera_infrastructure, public.camera_health_history,
  public.edge_nodes, public.edge_heartbeats, public.discovered_devices
from anon, authenticated;

revoke all on public.camera_infrastructure_unresolved_legacy from anon, authenticated;
grant select on public.camera_infrastructure_unresolved_legacy to service_role;
