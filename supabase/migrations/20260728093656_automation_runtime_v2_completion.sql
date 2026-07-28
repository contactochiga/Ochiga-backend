alter table public.consumer_automations
  add column if not exists next_run_at timestamptz,
  add column if not exists last_run_at timestamptz,
  add column if not exists last_run_status text,
  add column if not exists timezone text,
  add column if not exists schedule_version integer not null default 1;

create table if not exists public.consumer_automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.consumer_automations(id) on delete cascade,
  estate_id uuid references public.estates(id) on delete cascade,
  home_id uuid references public.homes(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  trigger_type text not null,
  trigger_occurrence_key text not null,
  source text not null check (source in ('scheduled','manual_test')),
  status text not null check (status in ('queued','evaluating','running','succeeded','partially_succeeded','failed','skipped','cancelled')),
  scheduled_for timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint consumer_automation_runs_occurrence_unique unique (automation_id, trigger_occurrence_key)
);

create index if not exists consumer_automations_due_idx
  on public.consumer_automations (enabled, next_run_at)
  where enabled = true and next_run_at is not null;

create index if not exists consumer_automation_runs_scope_idx
  on public.consumer_automation_runs (estate_id, home_id, created_at desc);

create index if not exists consumer_automation_runs_automation_idx
  on public.consumer_automation_runs (automation_id, created_at desc);

alter table public.consumer_automation_runs enable row level security;

revoke all on public.consumer_automation_runs from anon, authenticated;

comment on column public.consumer_automations.next_run_at is 'Next due scheduled automation occurrence calculated from the validated canonical trigger contract.';
comment on column public.consumer_automations.last_run_status is 'Most recent Automation Runtime V2 run status.';
comment on table public.consumer_automation_runs is 'Durable resident-scoped Automation Runtime V2 run ledger. Accessed through authenticated backend routes.';
