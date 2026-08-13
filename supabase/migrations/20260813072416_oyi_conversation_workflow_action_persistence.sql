-- Oyi Permanent-Site Phase C: durable conversation workflow/action state.
-- Safe additive migration: no drops, no destructive updates.

create table if not exists public.oyi_conversation_workflows (
  id uuid primary key default gen_random_uuid(),
  workflow_id text not null unique,
  thread_id uuid null references public.oyi_conversation_threads(id) on delete set null,
  actor_id uuid null,
  surface text not null default 'consumer',
  domain text not null,
  capability_key text not null,
  operation text not null,
  status text not null,
  estate_id uuid null,
  building_id uuid null,
  home_id uuid null,
  room_id uuid null,
  target_type text null,
  target_id text null,
  target_label text null,
  target_channel_code text null,
  revision integer not null default 1,
  unresolved_inputs jsonb not null default '[]'::jsonb,
  authority_decision jsonb null,
  proposed_action jsonb null,
  execution_record jsonb null,
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  action_id text null,
  request_id text null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  superseded_at timestamptz null,
  constraint oyi_conversation_workflows_status_check check (
    status in (
      'collecting_inputs',
      'awaiting_clarification',
      'ready_for_review',
      'awaiting_approval',
      'approved',
      'executing',
      'verifying',
      'answered',
      'empty',
      'unavailable',
      'unsupported',
      'permission_restricted',
      'completed',
      'failed',
      'cancelled',
      'expired',
      'superseded'
    )
  )
);

create table if not exists public.oyi_conversation_workflow_inputs (
  id uuid primary key default gen_random_uuid(),
  workflow_id text not null references public.oyi_conversation_workflows(workflow_id) on delete cascade,
  input_key text not null,
  value jsonb not null default 'null'::jsonb,
  source text not null default 'user',
  validated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_id, input_key)
);

create table if not exists public.oyi_actions (
  id uuid primary key default gen_random_uuid(),
  action_id text not null unique,
  workflow_id text not null references public.oyi_conversation_workflows(workflow_id) on delete cascade,
  thread_id uuid null references public.oyi_conversation_threads(id) on delete set null,
  actor_id uuid null,
  domain text not null,
  capability_key text not null,
  target_type text not null,
  target_id text not null,
  target_channel_code text null,
  target_label text null,
  requested_operation text not null,
  requested_state jsonb null,
  status text not null,
  idempotency_key text not null,
  revision integer not null default 1,
  approved_at timestamptz null,
  queued_at timestamptz null,
  sent_at timestamptz null,
  provider_accepted_at timestamptz null,
  verification_started_at timestamptz null,
  completed_at timestamptz null,
  executor_reference jsonb null,
  result jsonb null,
  safe_error jsonb null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oyi_actions_status_check check (
    status in (
      'draft',
      'awaiting_confirmation',
      'approved',
      'queued',
      'sent',
      'provider_accepted',
      'provider_rejected',
      'verifying',
      'confirmed',
      'unobservable',
      'timed_out',
      'failed',
      'cancelled',
      'superseded'
    )
  )
);

create table if not exists public.oyi_action_events (
  id uuid primary key default gen_random_uuid(),
  action_id text not null references public.oyi_actions(action_id) on delete cascade,
  event_type text not null,
  from_status text null,
  to_status text null,
  actor_id uuid null,
  source text not null default 'oyi_core',
  summary text null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.oyi_action_evidence (
  id uuid primary key default gen_random_uuid(),
  action_id text not null references public.oyi_actions(action_id) on delete cascade,
  evidence_type text not null,
  evidence_id text null,
  source_type text null,
  source_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_oyi_conversation_workflows_thread_status
  on public.oyi_conversation_workflows(thread_id, status, updated_at desc);
create index if not exists idx_oyi_conversation_workflows_actor_status
  on public.oyi_conversation_workflows(actor_id, status, updated_at desc);
create index if not exists idx_oyi_conversation_workflows_scope
  on public.oyi_conversation_workflows(surface, estate_id, home_id, room_id, status);
create index if not exists idx_oyi_conversation_workflows_capability
  on public.oyi_conversation_workflows(capability_key, status, updated_at desc);
create index if not exists idx_oyi_conversation_workflow_inputs_workflow
  on public.oyi_conversation_workflow_inputs(workflow_id, updated_at desc);

create index if not exists idx_oyi_actions_workflow_status
  on public.oyi_actions(workflow_id, status, updated_at desc);
create index if not exists idx_oyi_actions_thread_status
  on public.oyi_actions(thread_id, status, updated_at desc);
create index if not exists idx_oyi_actions_actor_status
  on public.oyi_actions(actor_id, status, updated_at desc);
create index if not exists idx_oyi_actions_idempotency
  on public.oyi_actions(idempotency_key, status, created_at desc);
create index if not exists idx_oyi_actions_capability
  on public.oyi_actions(capability_key, status, updated_at desc);
create index if not exists idx_oyi_action_events_action_time
  on public.oyi_action_events(action_id, occurred_at asc);
create index if not exists idx_oyi_action_evidence_action
  on public.oyi_action_evidence(action_id, created_at asc);

alter table public.oyi_conversation_workflows enable row level security;
alter table public.oyi_conversation_workflow_inputs enable row level security;
alter table public.oyi_actions enable row level security;
alter table public.oyi_action_events enable row level security;
alter table public.oyi_action_evidence enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'oyi_conversation_workflows'
      and policyname = 'oyi_conversation_workflows_owner_select'
  ) then
    create policy "oyi_conversation_workflows_owner_select"
      on public.oyi_conversation_workflows for select
      to authenticated
      using (auth.uid() = actor_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'oyi_actions'
      and policyname = 'oyi_actions_owner_select'
  ) then
    create policy "oyi_actions_owner_select"
      on public.oyi_actions for select
      to authenticated
      using (auth.uid() = actor_id);
  end if;
end $$;

comment on table public.oyi_conversation_workflows is 'Durable Oyi Core conversation workflow state. Backend-mediated; separate from operational ochiga_workflows.';
comment on table public.oyi_actions is 'Durable Oyi Core conversation action orchestration state. References, but does not replace, domain execution ledgers.';
