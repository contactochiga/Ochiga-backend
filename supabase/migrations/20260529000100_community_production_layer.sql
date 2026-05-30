-- Community production coordination layer: categories, pinning, targeting, reads, reports, durable live sessions.

alter table if exists community_posts
  add column if not exists category text default 'resident',
  add column if not exists is_pinned boolean default false,
  add column if not exists pinned_until timestamptz null,
  add column if not exists audience_type text default 'all_estate',
  add column if not exists audience_ref text null,
  add column if not exists scheduled_at timestamptz null,
  add column if not exists priority text null,
  add column if not exists media jsonb default '[]'::jsonb,
  add column if not exists live_link text null;

create index if not exists idx_community_posts_estate_category_created
  on community_posts(estate_id, category, created_at desc);

create index if not exists idx_community_posts_estate_pinned
  on community_posts(estate_id, is_pinned, pinned_until);

create table if not exists community_read_receipts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references community_posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  estate_id uuid null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(post_id, user_id)
);

create index if not exists idx_community_read_receipts_post
  on community_read_receipts(post_id, read_at desc);

create index if not exists idx_community_read_receipts_user
  on community_read_receipts(user_id, read_at desc);

create table if not exists community_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references community_posts(id) on delete cascade,
  reporter_user_id uuid not null references users(id) on delete cascade,
  estate_id uuid null,
  reason text not null default 'reported',
  details text null,
  status text not null default 'open',
  resolved_by uuid null references users(id),
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_community_post_reports_estate_status
  on community_post_reports(estate_id, status, created_at desc);

create table if not exists community_live_sessions (
  post_id uuid primary key references community_posts(id) on delete cascade,
  estate_id uuid null,
  host_user_id uuid null references users(id),
  guest_user_id uuid null references users(id),
  guest_display_name text null,
  status text not null default 'starting',
  viewer_count integer not null default 0,
  has_guest boolean not null default false,
  pending_request_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_community_live_sessions_estate_status
  on community_live_sessions(estate_id, status, updated_at desc);
