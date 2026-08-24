-- Phase 5: normalized camera detections and frame-coordinate zones.
create table if not exists public.camera_detection_zones (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid not null references public.facility_cameras(id) on delete cascade,
  estate_id uuid not null references public.estates(id) on delete cascade,
  home_id uuid null references public.homes(id) on delete cascade,
  name text not null,
  kind text not null default 'region' check (kind in ('region','line')),
  geometry jsonb not null,
  enabled boolean not null default true,
  detection_types text[] not null default '{}',
  minimum_confidence double precision null check (minimum_confidence between 0 and 1),
  restricted boolean not null default false,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(camera_id, name)
);

create table if not exists public.camera_detections (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid not null references public.facility_cameras(id) on delete cascade,
  estate_id uuid not null references public.estates(id) on delete cascade,
  home_id uuid null references public.homes(id) on delete cascade,
  event_id uuid null references public.camera_events(id) on delete set null,
  media_id uuid null references public.camera_media(id) on delete set null,
  detection_type text not null,
  observed_at timestamptz not null,
  confidence double precision null check (confidence between 0 and 1),
  bounding_box jsonb null,
  visual_zone_id uuid null references public.camera_detection_zones(id) on delete set null,
  tracking_id text null,
  attributes jsonb not null default '{}',
  provider text not null,
  model text null,
  model_version text null,
  provider_observation_id text null,
  idempotency_key text not null,
  aggregation_key text not null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  unique(camera_id, idempotency_key)
);

create index if not exists idx_camera_detections_camera_time on public.camera_detections(camera_id, observed_at desc, id desc);
create index if not exists idx_camera_detections_event on public.camera_detections(event_id, observed_at desc);
create index if not exists idx_camera_detections_media on public.camera_detections(media_id) where media_id is not null;
create index if not exists idx_camera_detections_type on public.camera_detections(detection_type, observed_at desc);
create index if not exists idx_camera_detections_tenant on public.camera_detections(estate_id, home_id, observed_at desc);
create index if not exists idx_camera_detections_expiry on public.camera_detections(expires_at) where expires_at is not null and event_id is null;
create index if not exists idx_camera_detection_zones_camera on public.camera_detection_zones(camera_id, enabled);

alter table public.camera_detections enable row level security;
alter table public.camera_detection_zones enable row level security;
revoke all on public.camera_detections, public.camera_detection_zones from anon, authenticated;

comment on table public.camera_detections is 'Server-authoritative normalized observations. Identity recognition and raw provider payloads are intentionally excluded.';
comment on column public.camera_detections.bounding_box is 'Normalized x/y/width/height coordinates in the inclusive 0.0 to 1.0 frame space.';
comment on table public.camera_detection_zones is 'Camera-frame visual regions/lines; distinct from estate geographic zones.';
