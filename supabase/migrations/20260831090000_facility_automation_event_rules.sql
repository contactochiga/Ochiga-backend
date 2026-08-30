-- Facility Automation -- Cross-Domain Fabric Closure.
--
-- One new, purely additive table. Does not touch consumer_automations,
-- facility_automation_policy, or automation_approvals -- fully backward
-- compatible with every existing schedule-based rule, scene, and Office/
-- Consumer automation. A rule here describes an EVENT trigger (a real
-- event_type already flowing through publishIntelligenceEvent) plus
-- optional typed conditions plus a single registered action -- matching
-- the same governed pipeline (automationPolicyResolver -> automation_
-- approvals -> executeRegisteredAction) every other action already uses.
--
-- action_id is intentionally NOT foreign-keyed to anything -- the
-- authoritative validation that it's a real, available EXECUTION_REGISTRY
-- entry happens at the application layer (src/routes/facility.routes.ts)
-- at create/update time, the same way facility_automation_policy's
-- action_id is validated. A DB-level check here would need to duplicate
-- the registry's contents and drift from it.
create table if not exists facility_automation_event_rules (
  id uuid primary key default gen_random_uuid(),
  estate_id uuid not null references estates(id) on delete cascade,
  name text not null,
  trigger_event_type text not null,
  conditions jsonb not null default '[]'::jsonb,
  action_id text not null,
  action_params jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists facility_automation_event_rules_estate_idx
  on facility_automation_event_rules (estate_id);

-- The hot-path lookup: "which enabled rules for this estate match this
-- event_type" runs on every intelligence event published anywhere in the
-- platform, so it must be a single indexed lookup, not a table scan.
create index if not exists facility_automation_event_rules_trigger_idx
  on facility_automation_event_rules (estate_id, trigger_event_type)
  where enabled = true;

-- Same pattern as automation_approvals/facility_automation_policy
-- (20260830110000): every code path touches this table exclusively via
-- supabaseAdmin (service-role, bypasses RLS); enabling RLS + revoking
-- direct anon/authenticated access here from the start avoids the gap the
-- security audit had to catch retroactively on the Milestone 1 tables.
alter table facility_automation_event_rules enable row level security;
revoke all on facility_automation_event_rules from anon, authenticated;
