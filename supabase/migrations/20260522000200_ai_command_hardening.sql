-- Oyi AI Phase 1 command hardening foundation.
-- This table is an execution/confirmation ledger only. It must not store raw audio or secrets.

create table if not exists ai_execution_ledger (
  id uuid default gen_random_uuid() primary key,
  actor_user_id text,
  actor_email text,
  actor_role text,
  estate_id text,
  home_id text,
  tool_id text not null,
  prompt_excerpt text,
  execution_status text not null default 'pending_confirmation',
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  executed_at timestamptz,
  denied_at timestamptz,
  result_summary text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  contract_version text not null default 'ochiga.ai.phase1.2026-05-22',
  constraint ai_execution_ledger_status_check check (
    execution_status in ('pending_confirmation', 'confirmed', 'denied', 'expired', 'executed', 'failed')
  )
);

create index if not exists idx_ai_execution_ledger_requested
  on ai_execution_ledger(requested_at desc);

create index if not exists idx_ai_execution_ledger_actor
  on ai_execution_ledger(actor_user_id, requested_at desc);

create index if not exists idx_ai_execution_ledger_estate
  on ai_execution_ledger(estate_id, requested_at desc);

create index if not exists idx_ai_execution_ledger_home
  on ai_execution_ledger(home_id, requested_at desc);

create index if not exists idx_ai_execution_ledger_tool
  on ai_execution_ledger(tool_id, requested_at desc);

create index if not exists idx_ai_execution_ledger_status
  on ai_execution_ledger(execution_status, requested_at desc);
