-- Ochiga/Oyi Tier 1 shared audit and event foundation.
-- This table is intentionally generic so Office, Facility, Consumer, Edge,
-- Digital Twin, Plan Studio, and Oyi AI can emit the same audit contract.

create table if not exists audit_events (
  id uuid default gen_random_uuid() primary key,
  actor_id text,
  actor_email text,
  actor_role text,
  action text not null,
  resource_type text not null,
  resource_id text,
  estate_id text,
  home_id text,
  status text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  surface text,
  contract_version text not null default 'ochiga.tier1.2026-05-16',
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_created
  on audit_events(created_at desc);

create index if not exists idx_audit_events_actor
  on audit_events(actor_id, created_at desc);

create index if not exists idx_audit_events_action
  on audit_events(action, created_at desc);

create index if not exists idx_audit_events_resource
  on audit_events(resource_type, resource_id, created_at desc);

create index if not exists idx_audit_events_estate
  on audit_events(estate_id, created_at desc);

create index if not exists idx_audit_events_home
  on audit_events(home_id, created_at desc);
