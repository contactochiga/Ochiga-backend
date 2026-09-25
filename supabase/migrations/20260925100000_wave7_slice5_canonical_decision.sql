-- Wave 7 Slice 5 -- Canonical Decision object.
--
-- One additive table, modeled on automation_approvals' own proven shape
-- (20260830090000_facility_automation_policy_and_approvals.sql),
-- generalized to entity_type/entity_id per the accepted Slice 0 roadmap
-- (docs/WAVE7_DECISION_PLANNING_AUTHORITY_AUDIT.md §37 row 5). Coexists
-- additively -- automation_approvals remains untouched and authoritative
-- for Facility Automation; nothing here replaces it.
--
-- A Decision is the durable record that a specific course of action, for
-- a specific entity, has been SELECTED -- distinct from a Recommendation
-- (advisory only), an Approval (gates whether a selected action may
-- proceed), and an Execution (the attempt to perform it). This table
-- never drives execution directly -- see DecisionStore.ts.
create table if not exists oyi_decisions (
  id uuid primary key default gen_random_uuid(),

  -- Stable semantic identity -- derived from real inputs (never a
  -- positional/index value, per Slice 2's own lesson). Unique so a
  -- replayed/retried producer call is naturally idempotent.
  decision_key text not null,

  entity_type text not null,
  entity_id text not null,

  action_type text not null,
  title text not null,
  reason text,

  status text not null default 'selected'
    check (status in ('selected', 'awaiting_human', 'approved', 'rejected', 'superseded', 'cancelled')),
  requires_human boolean not null default false,

  selected_by text not null default 'system',
  authority_mode text not null
    check (authority_mode in ('deterministic_policy', 'human_selection')),
  policy_source text,

  -- Lineage -- all honestly nullable. No Decision is required to trace
  -- back to any of these; no foreign key is added to any of them (they
  -- span multiple independently-written systems/tables, several without
  -- a matching uuid shape -- the same "nullable, no fabricated FK"
  -- rationale Slice 2 already established for oyi_goals.canonical_signal_key).
  canonical_signal_key text,
  recommendation_key text,
  goal_id uuid references oyi_goals(id) on delete set null,
  plan_id text,
  incident_id text,
  awareness_key text,

  superseded_by uuid references oyi_decisions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  closed_at timestamptz
);

-- Idempotent creation: the same real-world selection, replayed, must
-- resolve to the same row, never a duplicate.
create unique index if not exists oyi_decisions_decision_key_key on oyi_decisions (decision_key);

create index if not exists oyi_decisions_entity_idx on oyi_decisions (entity_type, entity_id);
create index if not exists oyi_decisions_canonical_signal_key_idx on oyi_decisions (canonical_signal_key) where canonical_signal_key is not null;
create index if not exists oyi_decisions_recommendation_key_idx on oyi_decisions (recommendation_key) where recommendation_key is not null;
create index if not exists oyi_decisions_goal_id_idx on oyi_decisions (goal_id) where goal_id is not null;

-- Active/current-decision queries (HumanInterventionView integration,
-- read service) stay index-backed without scanning terminal rows.
create index if not exists oyi_decisions_active_idx on oyi_decisions (entity_type, entity_id, status)
  where status in ('selected', 'awaiting_human', 'approved');
