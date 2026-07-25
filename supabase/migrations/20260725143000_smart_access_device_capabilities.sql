-- Provider-neutral Smart Access capability projection.
-- This extends the existing canonical device registry/runtime; it does not add a
-- second device registry or command path.

create table if not exists public.smart_access_capability_snapshots (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  estate_id uuid not null,
  home_id uuid,
  provider text not null default 'unknown',
  provider_connection_id uuid,
  provider_category text,
  provider_product_id text,
  provider_model text,
  profile_version integer not null default 1,
  capabilities jsonb not null default '{}'::jsonb,
  state_snapshot jsonb not null default '{}'::jsonb,
  raw_fingerprint text not null,
  detected_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  detection_source text not null default 'runtime',
  provider_schema_version text,
  detection_error jsonb,
  confidence jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.smart_access_capability_snapshots
  add column if not exists device_id uuid,
  add column if not exists estate_id uuid,
  add column if not exists home_id uuid,
  add column if not exists provider text default 'unknown',
  add column if not exists provider_connection_id uuid,
  add column if not exists provider_category text,
  add column if not exists provider_product_id text,
  add column if not exists provider_model text,
  add column if not exists profile_version integer default 1,
  add column if not exists capabilities jsonb default '{}'::jsonb,
  add column if not exists state_snapshot jsonb default '{}'::jsonb,
  add column if not exists raw_fingerprint text,
  add column if not exists detected_at timestamptz default now(),
  add column if not exists last_verified_at timestamptz default now(),
  add column if not exists detection_source text default 'runtime',
  add column if not exists provider_schema_version text,
  add column if not exists detection_error jsonb,
  add column if not exists confidence jsonb default '{}'::jsonb,
  add column if not exists evidence jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists smart_access_capability_snapshots_device_fingerprint_uidx
  on public.smart_access_capability_snapshots(device_id, raw_fingerprint);

create index if not exists smart_access_capability_snapshots_device_verified_idx
  on public.smart_access_capability_snapshots(device_id, last_verified_at desc);

create index if not exists smart_access_capability_snapshots_home_idx
  on public.smart_access_capability_snapshots(estate_id, home_id);

create table if not exists public.smart_access_records (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  estate_id uuid not null,
  home_id uuid,
  provider_connection_id uuid,
  event_type text not null,
  access_method text,
  subject_label_masked text,
  occurred_at timestamptz not null default now(),
  severity text not null default 'info',
  privacy_scope text not null default 'home',
  evidence jsonb not null default '{}'::jsonb,
  deduplication_key text,
  created_at timestamptz not null default now()
);

create index if not exists smart_access_records_device_time_idx
  on public.smart_access_records(device_id, occurred_at desc);

create index if not exists smart_access_records_home_time_idx
  on public.smart_access_records(estate_id, home_id, occurred_at desc);

create unique index if not exists smart_access_records_dedup_uidx
  on public.smart_access_records(deduplication_key)
  where deduplication_key is not null;

create table if not exists public.smart_access_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  estate_id uuid not null,
  home_id uuid,
  provider_connection_id uuid,
  credential_type text not null,
  subject_label_masked text,
  status text not null default 'pending',
  effective_at timestamptz,
  expires_at timestamptz,
  schedule jsonb not null default '{}'::jsonb,
  provider_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists smart_access_credentials_device_status_idx
  on public.smart_access_credentials(device_id, status, created_at desc);

create index if not exists smart_access_credentials_home_idx
  on public.smart_access_credentials(estate_id, home_id, created_at desc);
