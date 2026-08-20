-- Tasks Domain UI (Office) — Office has no per-user Backend identity to
-- attach to an automation's created_by (see the Shared Automation
-- Runtime PR 3 fix: created_by stays null for office-surfaced rows).
-- The Office UI still needs a human-readable "Owner" to display and
-- let staff set, so this adds a plain display-label column, exactly
-- mirroring the existing crm_tasks.owner text field's shape. Nullable,
-- additive — Consumer/Facility automations continue deriving owner
-- display from created_by -> users, unaffected.
alter table public.consumer_automations
  add column if not exists owner text;

comment on column public.consumer_automations.owner is
  'Human-readable owner label for automations with no real Backend user identity (currently: office surface). Consumer/facility automations derive owner display from created_by instead and typically leave this null.';
