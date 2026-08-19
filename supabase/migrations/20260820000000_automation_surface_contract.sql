-- Shared Automation Runtime, PR 1 (infrastructure only) — adds the
-- canonical surface contract to consumer_automations so the existing,
-- already-live scheduler can eventually dispatch definitions for
-- facility and office alongside consumer, without duplicating the
-- table or the scheduler. Every existing row resolves to 'consumer'
-- via the column default — no backfill required, no row is touched.
alter table public.consumer_automations
  add column if not exists surface text not null default 'consumer'
    check (surface in ('consumer', 'facility', 'office'));

comment on column public.consumer_automations.surface is
  'Which product surface owns this automation definition. Existing rows default to consumer. Facility/office creation is feature-flag gated (see AUTOMATION_SURFACE_FACILITY_ENABLED / AUTOMATION_SURFACE_OFFICE_ENABLED) and not yet wired into the scheduler dispatch path.';

-- Scheduler due-scan stays served by the existing consumer_automations_due_idx
-- (enabled, next_run_at) — this adds a surface-aware companion index for the
-- new WHERE ... AND surface = ANY(...) clause without touching that index.
create index if not exists consumer_automations_surface_due_idx
  on public.consumer_automations (surface, enabled, next_run_at)
  where enabled = true and next_run_at is not null;
