create table if not exists public.operational_signals (
  id uuid primary key default gen_random_uuid(),
  canonical_signal_key text not null,
  producer text,
  provider text,
  provider_event_id text,
  signal_type text not null,
  domain text not null,
  severity text not null,
  confidence numeric,
  trust_score numeric,
  verified boolean not null default false,
  verification_method text,
  estate_id uuid references public.estates(id) on delete set null,
  building_id uuid,
  home_id uuid references public.homes(id) on delete set null,
  room_id uuid,
  entity_type text,
  entity_id text,
  actor_id text,
  privacy_class text not null default 'organization_restricted',
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  runtime_id text,
  correlation_id text,
  execution_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_operational_signals_key on public.operational_signals(canonical_signal_key);
create index if not exists idx_operational_signals_scope_time on public.operational_signals(estate_id, home_id, occurred_at desc);
create index if not exists idx_operational_signals_privacy_time on public.operational_signals(privacy_class, occurred_at desc);
create index if not exists idx_operational_signals_entity_time on public.operational_signals(entity_type, entity_id, occurred_at desc);

create table if not exists public.operational_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_key text not null,
  incident_type text not null,
  domain text not null,
  title text not null,
  scope jsonb not null default '{}'::jsonb,
  privacy_class text not null,
  status text not null default 'open',
  severity text not null default 'info',
  confidence numeric,
  owner_type text,
  owner_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  current_summary text,
  affected_entities jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  parent_incident_id uuid references public.operational_incidents(id) on delete set null,
  estate_id uuid references public.estates(id) on delete set null,
  home_id uuid references public.homes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_operational_incidents_key on public.operational_incidents(incident_key);
create index if not exists idx_operational_incidents_scope_status on public.operational_incidents(estate_id, home_id, status, last_seen_at desc);

create table if not exists public.operational_awareness (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.operational_incidents(id) on delete set null,
  awareness_key text not null,
  audience text not null,
  status text not null default 'open',
  title text not null,
  summary text not null,
  reason text,
  impact text,
  urgency text,
  owner text,
  recommended_action text,
  verification text,
  confidence numeric,
  score_breakdown jsonb not null default '{}'::jsonb,
  related_signals text[] not null default '{}',
  related_executions text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);

create unique index if not exists idx_operational_awareness_key on public.operational_awareness(awareness_key);

create table if not exists public.operational_insights (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.operational_incidents(id) on delete set null,
  domain text not null,
  insight_type text not null,
  reasoning_version text not null default 'v3',
  title text not null,
  summary text not null,
  reason text,
  impact text,
  confidence numeric,
  evidence jsonb not null default '[]'::jsonb,
  owner text,
  verification text,
  next_step text,
  status text not null default 'open',
  generated_at timestamptz not null default now(),
  superseded_at timestamptz
);

create table if not exists public.operational_recommendations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.operational_incidents(id) on delete set null,
  recommendation_key text not null,
  action_type text not null,
  target jsonb not null default '{}'::jsonb,
  title text not null,
  summary text not null,
  reason text,
  expected_impact text,
  confidence numeric,
  urgency text,
  risk_class text,
  verification_required boolean not null default true,
  approval_required boolean not null default false,
  safe_to_automate boolean not null default false,
  status text not null default 'pending',
  accepted_by text,
  dismissed_by text,
  resolved_by text,
  outcome jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  estate_id uuid references public.estates(id) on delete set null,
  home_id uuid references public.homes(id) on delete set null,
  privacy_class text not null default 'organization_restricted',
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_operational_recommendations_key on public.operational_recommendations(recommendation_key);
create index if not exists idx_operational_recommendations_scope_status on public.operational_recommendations(estate_id, home_id, status, updated_at desc);

create table if not exists public.operational_plans (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid references public.operational_recommendations(id) on delete set null,
  plan_type text not null,
  canonical_operation_id text,
  target jsonb not null default '{}'::jsonb,
  preconditions jsonb not null default '[]'::jsonb,
  safety_checks jsonb not null default '[]'::jsonb,
  required_permissions text[] not null default '{}',
  approval_state text,
  rollback_plan text,
  status text not null default 'planned',
  generated_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.intelligence_feedback (
  id uuid primary key default gen_random_uuid(),
  object_type text not null,
  object_id text not null,
  feedback_type text not null,
  actor_id text,
  reason text,
  outcome_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.operational_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null,
  channel text not null,
  audience jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  redaction_version text not null default 'v1',
  status text not null default 'pending',
  attempt_count integer not null default 0,
  acknowledged_at timestamptz,
  dead_letter_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_operational_delivery_outbox_key on public.operational_delivery_outbox(delivery_key);
create index if not exists idx_operational_delivery_outbox_status on public.operational_delivery_outbox(status, created_at);

alter table public.operational_signals enable row level security;
alter table public.operational_incidents enable row level security;
alter table public.operational_awareness enable row level security;
alter table public.operational_insights enable row level security;
alter table public.operational_recommendations enable row level security;
alter table public.operational_plans enable row level security;
alter table public.intelligence_feedback enable row level security;
alter table public.operational_delivery_outbox enable row level security;
