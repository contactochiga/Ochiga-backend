-- Camera intelligence events for rewind + detection timeline

create table if not exists camera_events (
  id uuid default gen_random_uuid() primary key,
  camera_id uuid not null references facility_cameras(id) on delete cascade,
  estate_id uuid not null references estates(id) on delete cascade,
  event_type text not null,
  confidence double precision null,
  snapshot_url text null,
  message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_camera_events_camera_created on camera_events(camera_id, created_at desc);
create index if not exists idx_camera_events_estate_created on camera_events(estate_id, created_at desc);
create index if not exists idx_camera_events_type on camera_events(event_type);
