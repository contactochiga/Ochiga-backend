-- Ochiga/Oyi Tier 1 shared storage metadata foundation.

create table if not exists platform_files (
  id uuid default gen_random_uuid() primary key,
  file_id text not null unique,
  owner_type text not null,
  owner_id text,
  estate_id text,
  home_id text,
  purpose text not null,
  filename text not null,
  mime_type text not null default 'application/octet-stream',
  size bigint not null default 0,
  storage_driver text not null default 'unknown',
  storage_path text not null default '',
  public_url text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_platform_files_owner on platform_files(owner_type, owner_id, created_at desc);
create index if not exists idx_platform_files_estate on platform_files(estate_id, created_at desc);
create index if not exists idx_platform_files_home on platform_files(home_id, created_at desc);
create index if not exists idx_platform_files_purpose on platform_files(purpose, created_at desc);
