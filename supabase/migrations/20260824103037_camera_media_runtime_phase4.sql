-- Oyi Camera Media Runtime Phase 4. Server-authoritative catalogue and private bucket.
create table if not exists public.camera_media (
  id uuid primary key default gen_random_uuid(),
  camera_id uuid not null references public.facility_cameras(id) on delete cascade,
  estate_id uuid not null references public.estates(id) on delete cascade,
  home_id uuid references public.homes(id) on delete set null,
  kind text not null check (kind in ('snapshot','event_snapshot','thumbnail','clip','recording_segment','recording')),
  captured_at timestamptz not null,
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 3600000),
  mime_type text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  content_sha256 text,
  storage_provider text not null default 'supabase',
  storage_bucket text not null default 'camera-media-private',
  storage_key text not null,
  status text not null default 'ready' check (status in ('pending','ready','expired','deleted','failed')),
  retention_class text not null default 'standard' check (retention_class in ('ephemeral','standard','security','evidence')),
  expires_at timestamptz,
  preserved_at timestamptz,
  preserved_by uuid references public.users(id) on delete set null,
  preservation_reason text,
  source text not null default 'edge' check (source in ('edge','nvr','cloud','manual')),
  edge_node_id text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (camera_id, idempotency_key),
  unique (storage_bucket, storage_key)
);

create table if not exists public.camera_event_media (
  event_id uuid not null references public.camera_events(id) on delete cascade,
  media_id uuid not null references public.camera_media(id) on delete cascade,
  relationship text not null default 'evidence' check (relationship in ('primary','evidence','thumbnail','clip')),
  created_at timestamptz not null default now(),
  primary key (event_id, media_id)
);

create table if not exists public.camera_recording_policies (
  camera_id uuid primary key references public.facility_cameras(id) on delete cascade,
  estate_id uuid not null references public.estates(id) on delete cascade,
  mode text not null default 'off' check (mode in ('off','event_only','continuous','scheduled')),
  event_pre_roll_seconds integer check (event_pre_roll_seconds is null or event_pre_roll_seconds between 0 and 120),
  event_post_roll_seconds integer check (event_post_roll_seconds is null or event_post_roll_seconds between 0 and 600),
  retention_days integer check (retention_days is null or retention_days between 1 and 3650),
  schedule jsonb,
  provider text,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_camera_media_timeline on public.camera_media(camera_id, captured_at desc, id desc);
create index if not exists idx_camera_media_event on public.camera_event_media(event_id, created_at desc);
create index if not exists idx_camera_media_retention on public.camera_media(expires_at) where status='ready' and preserved_at is null;
create index if not exists idx_camera_media_tenant on public.camera_media(estate_id, home_id, captured_at desc);

alter table public.camera_media enable row level security;
alter table public.camera_event_media enable row level security;
alter table public.camera_recording_policies enable row level security;
revoke all on public.camera_media, public.camera_event_media, public.camera_recording_policies from anon, authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('camera-media-private','camera-media-private',false,52428800,array['image/jpeg','image/webp','video/mp4'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

comment on table public.camera_media is 'Private canonical camera media catalogue. Storage references never constitute authorization.';
