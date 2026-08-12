-- Canonical Oyi Communications durability.
-- Additive only: do not apply to production without release approval.

create table if not exists communications_sessions (
  id text primary key,
  surface text not null check (surface in ('community','office_public','office_internal','support')),
  purpose text not null,
  media_mode text not null check (media_mode in ('chat','voice','video','audio_video')),
  scope_type text not null check (scope_type in ('community_post','office_public_session','office_internal_session','support_thread')),
  scope_id text not null,
  owner_type text,
  owner_id text,
  public_session_id text,
  oyi_thread_id text,
  office_context_ref text,
  estate_id uuid,
  home_id uuid,
  status text not null check (status in ('starting','live','ended')),
  started_at timestamptz,
  ended_at timestamptz,
  last_activity_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_communications_sessions_surface_status
  on communications_sessions(surface, status, last_activity_at desc);

create index if not exists idx_communications_sessions_public_session
  on communications_sessions(public_session_id, last_activity_at desc)
  where public_session_id is not null;

create index if not exists idx_communications_sessions_oyi_thread
  on communications_sessions(oyi_thread_id, last_activity_at desc)
  where oyi_thread_id is not null;

create table if not exists communications_participants (
  id text primary key,
  session_id text not null references communications_sessions(id) on delete cascade,
  participant_type text not null check (participant_type in ('visitor','oyi','staff','specialist','system')),
  user_id text,
  public_session_id text,
  role text not null check (role in ('visitor','oyi','staff','specialist','host','viewer','guest','agent','customer')),
  state text not null check (state in ('invited','waiting','joined','left','declined')),
  permissions text[] not null default '{}',
  joined_at timestamptz,
  left_at timestamptz,
  invited_at timestamptz,
  accepted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_communications_participants_session_state
  on communications_participants(session_id, state, role);

create index if not exists idx_communications_participants_user
  on communications_participants(user_id, state)
  where user_id is not null;

create table if not exists communications_events (
  id text primary key,
  session_id text not null references communications_sessions(id) on delete cascade,
  participant_id text,
  event_type text not null,
  actor_type text,
  actor_id text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_communications_events_session_time
  on communications_events(session_id, created_at desc);

create table if not exists communications_handoffs (
  id text primary key,
  communications_session_id text not null references communications_sessions(id) on delete cascade,
  public_session_id text,
  oyi_thread_id text,
  office_context_ref text,
  business_unit text not null,
  requested_capability text not null,
  reason text not null,
  priority text not null check (priority in ('low','normal','high','urgent')),
  status text not null check (status in ('requested','routing','offered','accepted','declined','timed_out','cancelled','completed')),
  requested_at timestamptz not null default now(),
  assigned_staff_id text,
  accepted_at timestamptz,
  declined_at timestamptz,
  timed_out_at timestamptz,
  fallback_action text check (fallback_action is null or fallback_action in ('continue_with_oyi','request_callback','schedule_followup','leave_message')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_communications_handoffs_status
  on communications_handoffs(status, priority, requested_at);

create index if not exists idx_communications_handoffs_session
  on communications_handoffs(communications_session_id, requested_at desc);

alter table communications_sessions enable row level security;
alter table communications_participants enable row level security;
alter table communications_events enable row level security;
alter table communications_handoffs enable row level security;

drop policy if exists communications_sessions_service_role_only on communications_sessions;
create policy communications_sessions_service_role_only
  on communications_sessions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists communications_participants_service_role_only on communications_participants;
create policy communications_participants_service_role_only
  on communications_participants
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists communications_events_service_role_only on communications_events;
create policy communications_events_service_role_only
  on communications_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists communications_handoffs_service_role_only on communications_handoffs;
create policy communications_handoffs_service_role_only
  on communications_handoffs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
