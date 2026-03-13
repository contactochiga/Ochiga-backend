-- Estate messaging + moderation (alpha production baseline)

create table if not exists dm_threads (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  kind text not null default 'direct',
  user_a_id uuid null references users(id) on delete cascade,
  user_b_id uuid null references users(id) on delete cascade,
  title text null,
  created_by uuid null references users(id) on delete set null,
  is_archived boolean not null default false,
  last_message_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dm_threads_kind_chk check (kind in ('direct', 'group'))
);

create unique index if not exists ux_dm_threads_direct_pair
  on dm_threads(estate_id, kind, user_a_id, user_b_id)
  where kind = 'direct';

create index if not exists idx_dm_threads_estate_last_message
  on dm_threads(estate_id, last_message_at desc nulls last);

create table if not exists dm_thread_members (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid not null references dm_threads(id) on delete cascade,
  estate_id uuid not null references estates(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member',
  is_active boolean not null default true,
  muted_until timestamptz null,
  last_read_at timestamptz null,
  joined_at timestamptz not null default now(),
  left_at timestamptz null
);

create unique index if not exists ux_dm_thread_members_thread_user
  on dm_thread_members(thread_id, user_id);

create index if not exists idx_dm_thread_members_user_active
  on dm_thread_members(user_id, is_active);

create table if not exists dm_messages (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid not null references dm_threads(id) on delete cascade,
  estate_id uuid not null references estates(id) on delete cascade,
  sender_id uuid null references users(id) on delete set null,
  body text not null,
  message_type text not null default 'text',
  metadata jsonb not null default '{}'::jsonb,
  is_hidden boolean not null default false,
  hidden_reason text null,
  edited_at timestamptz null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dm_messages_thread_created
  on dm_messages(thread_id, created_at desc);

create index if not exists idx_dm_messages_estate_created
  on dm_messages(estate_id, created_at desc);

create table if not exists dm_reports (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  thread_id uuid not null references dm_threads(id) on delete cascade,
  message_id uuid not null references dm_messages(id) on delete cascade,
  reported_by uuid not null references users(id) on delete cascade,
  reason text not null,
  details text null,
  status text not null default 'open',
  resolution_action text null,
  resolved_by uuid null references users(id) on delete set null,
  resolved_note text null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dm_reports_status_chk check (status in ('open', 'resolved', 'dismissed'))
);

create unique index if not exists ux_dm_reports_message_reporter
  on dm_reports(message_id, reported_by);

create index if not exists idx_dm_reports_estate_status
  on dm_reports(estate_id, status, created_at desc);

create table if not exists dm_moderation_logs (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid not null references estates(id) on delete cascade,
  thread_id uuid null references dm_threads(id) on delete set null,
  message_id uuid null references dm_messages(id) on delete set null,
  actor_id uuid not null references users(id) on delete set null,
  target_user_id uuid null references users(id) on delete set null,
  action text not null,
  note text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dm_moderation_logs_estate_created
  on dm_moderation_logs(estate_id, created_at desc);

