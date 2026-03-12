-- Device push tokens for native notifications (iOS/Android)
create table if not exists user_push_tokens (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  platform text,
  device_id text,
  app_version text,
  active boolean not null default true,
  last_seen_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_user_push_tokens_user_id on user_push_tokens(user_id);
create index if not exists idx_user_push_tokens_active on user_push_tokens(active);

