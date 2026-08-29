-- PHASE 3 (Milestone 1) -- Oyi Facility Automation Operationalisation.
--
-- Two new, purely additive tables. Everything else this milestone reuses
-- existing canonical infrastructure (oyi-core's signal/awareness/reasoning/
-- recommendation pipeline, executeRegisteredAction, executionLedger/
-- ai_execution_ledger, verificationService, emitAuditEvent, NotificationService)
-- rather than duplicating it -- see docs note in
-- src/services/automationPolicyResolver.ts for the full architecture.
--
-- Scope is deliberately narrow: the only actions this milestone ever
-- executes are the ones already marked available:true in
-- src/intelligence-core/executionRegistry.ts (visitor.approve/revoke/expire,
-- maintenance.assign/complete/cancel, device.on/off/toggle) -- every other
-- action already carries its own explicit "use the existing workflow"
-- reason in that registry, which this migration does not touch or override.

-- facility_automation_policy: per-Facility override of the default
-- execution level for a registered action. Absence of a row means the
-- conservative default (approval_required) applies -- there is no UI to
-- create override rows yet in this milestone, so in practice this table
-- ships empty; it exists so the resolver has a real, tenant-scoped place
-- to check, not a placeholder.
create table if not exists facility_automation_policy (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  action_id text not null,
  execution_level text not null default 'approval_required'
    check (execution_level in ('observe', 'recommend', 'approval_required', 'auto_allowed', 'manual_only', 'unsupported')),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (estate_id, action_id)
);

create index if not exists facility_automation_policy_estate_idx
  on facility_automation_policy (estate_id);

-- automation_approvals: a single-purpose approval record. One row is
-- created either by a narrow, explicit server-side detector (system-
-- proposed) or by a human operator reviewing a specific real entity
-- (operator-proposed) -- never by inferring an executable action from the
-- abstract advisory recommendation taxonomy in oyi-core's AutomationPlan,
-- which is not concrete/parameter-shaped enough to execute safely.
--
-- `plan_snapshot` freezes exactly what was approved (action_id, entity_id,
-- parameters) at proposal time; approval/execution always re-reads this
-- snapshot rather than trusting anything the client sends at approve-time,
-- so an approved plan cannot be silently altered before execution.
create table if not exists automation_approvals (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  detector_id text not null,
  action_id text not null,
  entity_type text not null,
  entity_id uuid not null,
  target_label text,
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  plan_snapshot jsonb not null,
  status text not null default 'pending_approval'
    check (status in (
      'pending_approval', 'approved', 'rejected', 'expired', 'cancelled',
      'executing', 'succeeded', 'failed', 'verification_failed'
    )),
  requested_by text not null default 'system',
  approver_id uuid references users(id) on delete set null,
  approver_role text,
  decision_note text,
  execution_id text,
  verification jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz
);

create index if not exists automation_approvals_estate_idx
  on automation_approvals (estate_id);
create index if not exists automation_approvals_status_idx
  on automation_approvals (estate_id, status);

-- Prevents two concurrent pending proposals for the exact same detector
-- finding on the exact same entity (e.g. a duplicate-maintenance-request
-- detector running twice before the first proposal is decided) --
-- idempotency at the proposal layer, on top of (not instead of) the
-- execution-time idempotency key described in automationPolicyResolver.ts.
create unique index if not exists automation_approvals_one_pending_per_target
  on automation_approvals (estate_id, action_id, entity_id)
  where status = 'pending_approval';
