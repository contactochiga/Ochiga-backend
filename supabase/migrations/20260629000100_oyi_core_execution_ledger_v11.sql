alter table if exists ai_execution_ledger
  add column if not exists runtime_id text,
  add column if not exists signal_id text,
  add column if not exists building_id text,
  add column if not exists unit_id text,
  add column if not exists device_id text,
  add column if not exists provider text,
  add column if not exists origin text,
  add column if not exists initiator_type text,
  add column if not exists initiator_id text,
  add column if not exists initiator_role text,
  add column if not exists initiator_name text,
  add column if not exists action text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists duration_ms integer,
  add column if not exists approval_required boolean not null default false,
  add column if not exists approved_by text,
  add column if not exists rollback_available boolean not null default false,
  add column if not exists rollback_executed boolean not null default false,
  add column if not exists verification jsonb not null default '{}'::jsonb,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists reasoning_reference text,
  add column if not exists recommendation_reference text,
  add column if not exists automation_reference text,
  add column if not exists conversation_reference text,
  add column if not exists executive_reference text,
  add column if not exists provider_event_id text,
  add column if not exists session_id text,
  add column if not exists correlation_id text,
  add column if not exists trigger_reason text,
  add column if not exists verified boolean not null default false,
  add column if not exists verification_method text,
  add column if not exists trust_score double precision,
  add column if not exists execution_source text;

alter table if exists ai_execution_ledger
  drop constraint if exists ai_execution_ledger_status_check;

alter table if exists ai_execution_ledger
  add constraint ai_execution_ledger_status_check
  check (
    execution_status in (
      'pending_confirmation',
      'confirmed',
      'denied',
      'expired',
      'recorded',
      'executed',
      'failed'
    )
  );

create index if not exists idx_ai_execution_ledger_runtime
  on ai_execution_ledger(runtime_id, requested_at desc);

create index if not exists idx_ai_execution_ledger_signal
  on ai_execution_ledger(signal_id, requested_at desc);

create index if not exists idx_ai_execution_ledger_provider
  on ai_execution_ledger(provider, requested_at desc);
