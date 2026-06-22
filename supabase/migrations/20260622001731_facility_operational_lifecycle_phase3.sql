begin;

alter table public.maintenance_requests
  add column if not exists accepted_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists completion_summary text,
  add column if not exists completion_proof jsonb not null default '[]'::jsonb,
  add column if not exists resident_rating integer,
  add column if not exists resident_feedback text,
  add column if not exists verified_by_resident boolean not null default false,
  add column if not exists blocking_reason text;

create table if not exists public.maintenance_request_timeline (
  id uuid primary key default gen_random_uuid(),
  maintenance_request_id uuid not null references public.maintenance_requests(id) on delete cascade,
  estate_id uuid not null,
  actor_id uuid,
  action text not null,
  from_status text,
  to_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists maintenance_request_timeline_request_created_idx on public.maintenance_request_timeline(maintenance_request_id, created_at);
alter table public.maintenance_request_timeline enable row level security;
revoke all on table public.maintenance_request_timeline from anon, authenticated;

alter table public.facility_incidents
  add column if not exists assigned_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists response_log jsonb not null default '[]'::jsonb,
  add column if not exists blocking_reason text;

alter table public.notifications
  add column if not exists received_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists assigned_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists assigned_to uuid;

commit;
