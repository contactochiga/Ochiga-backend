-- Canonical Oyi Infrastructure Onboarding Engine.
-- Backend-owned staging and history only. Operational objects are promoted into
-- the existing device, camera, Edge, service, and Twin registries.

begin;

create extension if not exists "pgcrypto";

alter table if exists homes
  add column if not exists building_id uuid references estate_buildings(id) on delete set null;

create index if not exists idx_homes_building_id on homes(building_id);

create table if not exists infrastructure_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  partner_type text not null default 'other' check (partner_type in (
    'ochiga', 'installer', 'electrician', 'security_company',
    'automation_company', 'hvac', 'solar', 'networking',
    'access_control', 'oem', 'consultant', 'other'
  )),
  external_ref text,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  certification_status text not null default 'unverified' check (certification_status in ('unverified', 'verified', 'expired', 'suspended')),
  contact_name text,
  contact_email text,
  contact_phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_infrastructure_partners_external_ref
  on infrastructure_partners(external_ref) where external_ref is not null;
create index if not exists idx_infrastructure_partners_type_status
  on infrastructure_partners(partner_type, status, name);

create table if not exists infrastructure_partner_members (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references infrastructure_partners(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'installer',
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended', 'expired')),
  starts_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, user_id)
);

create table if not exists infrastructure_onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  onboarding_ref text not null unique,
  estate_id uuid not null references estates(id) on delete cascade,
  building_id uuid references estate_buildings(id) on delete set null,
  home_id uuid references homes(id) on delete set null,
  partner_id uuid references infrastructure_partners(id) on delete set null,
  installer_id uuid references users(id) on delete set null,
  initiated_by uuid references users(id) on delete set null,
  source_surface text not null default 'facility',
  version integer not null default 1,
  status text not null default 'created' check (status in (
    'created', 'discovering', 'authentication_required', 'discovered',
    'importing', 'verifying', 'ready', 'promoting', 'operational',
    'attention', 'failed', 'cancelled'
  )),
  notes text,
  summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_infrastructure_onboarding_sessions_estate
  on infrastructure_onboarding_sessions(estate_id, created_at desc);
create index if not exists idx_infrastructure_onboarding_sessions_status
  on infrastructure_onboarding_sessions(status, updated_at desc);

create table if not exists infrastructure_provider_connections (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  onboarding_session_id uuid references infrastructure_onboarding_sessions(id) on delete set null,
  provider_key text not null,
  adapter_key text,
  connection_key text not null,
  authentication_method text not null default 'none',
  authentication_status text not null default 'not_required' check (authentication_status in (
    'not_required', 'required', 'pending', 'authenticated', 'failed', 'expired', 'disconnected'
  )),
  credential_ref text,
  integration_owner_user_id uuid references users(id) on delete set null,
  external_account_id text,
  last_verified_at timestamptz,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estate_id, provider_key, connection_key)
);

create index if not exists idx_infrastructure_provider_connections_estate
  on infrastructure_provider_connections(estate_id, provider_key, authentication_status);

create table if not exists infrastructure_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references infrastructure_onboarding_sessions(id) on delete cascade,
  estate_id uuid not null references estates(id) on delete cascade,
  provider_key text not null,
  adapter_key text not null,
  identity_key text not null,
  external_id text,
  candidate_type text not null default 'unknown' check (candidate_type in (
    'device', 'camera', 'dvr_nvr', 'gateway', 'controller', 'meter',
    'access_system', 'edge_node', 'sensor', 'power_system',
    'infrastructure_asset', 'service', 'system', 'unknown'
  )),
  name text not null,
  category text,
  classification text not null default 'unknown' check (classification in (
    'compatible', 'needs_adapter', 'needs_edge', 'needs_credentials',
    'unsupported', 'unknown'
  )),
  classification_reason text,
  discovery_status text not null default 'discovered' check (discovery_status in (
    'discovered', 'classified', 'imported', 'verifying', 'verified',
    'verification_failed', 'promoted', 'rejected'
  )),
  online boolean,
  capabilities jsonb not null default '[]'::jsonb,
  protocols jsonb not null default '[]'::jsonb,
  proposed_home_id uuid references homes(id) on delete set null,
  proposed_room_id uuid references rooms(id) on delete set null,
  proposed_zone_id uuid references estate_zones(id) on delete set null,
  duplicate_target_type text,
  duplicate_target_id uuid,
  promoted_target_type text,
  promoted_target_id uuid,
  provider_metadata jsonb not null default '{}'::jsonb,
  mapping_metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  verified_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, identity_key)
);

create index if not exists idx_infrastructure_candidates_session
  on infrastructure_discovery_candidates(session_id, discovery_status, classification);
create index if not exists idx_infrastructure_candidates_estate_identity
  on infrastructure_discovery_candidates(estate_id, provider_key, external_id);

create table if not exists infrastructure_onboarding_verifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references infrastructure_onboarding_sessions(id) on delete cascade,
  candidate_id uuid not null references infrastructure_discovery_candidates(id) on delete cascade,
  estate_id uuid not null references estates(id) on delete cascade,
  result text not null check (result in ('passed', 'conditional', 'failed', 'waived')),
  checks jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  verified_by uuid references users(id) on delete set null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_infrastructure_verifications_candidate
  on infrastructure_onboarding_verifications(candidate_id, verified_at desc);

create table if not exists infrastructure_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references infrastructure_onboarding_sessions(id) on delete cascade,
  estate_id uuid not null references estates(id) on delete cascade,
  candidate_id uuid references infrastructure_discovery_candidates(id) on delete set null,
  actor_id uuid references users(id) on delete set null,
  event_type text not null,
  status text not null default 'recorded',
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_infrastructure_onboarding_events_session
  on infrastructure_onboarding_events(session_id, occurred_at desc);

create table if not exists infrastructure_compatibility_observations (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid references estates(id) on delete set null,
  session_id uuid references infrastructure_onboarding_sessions(id) on delete set null,
  provider_key text not null,
  adapter_key text,
  category text,
  product_key text,
  firmware_version text,
  classification text not null,
  outcome text not null,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_infrastructure_compatibility_lookup
  on infrastructure_compatibility_observations(provider_key, category, product_key, observed_at desc);

alter table infrastructure_partners enable row level security;
alter table infrastructure_partner_members enable row level security;
alter table infrastructure_onboarding_sessions enable row level security;
alter table infrastructure_provider_connections enable row level security;
alter table infrastructure_discovery_candidates enable row level security;
alter table infrastructure_onboarding_verifications enable row level security;
alter table infrastructure_onboarding_events enable row level security;
alter table infrastructure_compatibility_observations enable row level security;

revoke all on table infrastructure_partners from anon, authenticated;
revoke all on table infrastructure_partner_members from anon, authenticated;
revoke all on table infrastructure_onboarding_sessions from anon, authenticated;
revoke all on table infrastructure_provider_connections from anon, authenticated;
revoke all on table infrastructure_discovery_candidates from anon, authenticated;
revoke all on table infrastructure_onboarding_verifications from anon, authenticated;
revoke all on table infrastructure_onboarding_events from anon, authenticated;
revoke all on table infrastructure_compatibility_observations from anon, authenticated;

grant select, insert, update, delete on table infrastructure_partners to service_role;
grant select, insert, update, delete on table infrastructure_partner_members to service_role;
grant select, insert, update, delete on table infrastructure_onboarding_sessions to service_role;
grant select, insert, update, delete on table infrastructure_provider_connections to service_role;
grant select, insert, update, delete on table infrastructure_discovery_candidates to service_role;
grant select, insert, update, delete on table infrastructure_onboarding_verifications to service_role;
grant select, insert, update, delete on table infrastructure_onboarding_events to service_role;
grant select, insert, update, delete on table infrastructure_compatibility_observations to service_role;

commit;
