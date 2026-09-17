-- Wave 5 Slice 4 -- Event-Driven Facility Automation Device Verification
-- Reconciliation.
--
-- Durable, explicit correlation between an automation_approvals row and
-- the exact ai_execution_ledger row it dispatched, so the existing
-- runtime settlement path (deviceRuntimeStateService -> command ledger
-- confirmation) can reconcile the automation outcome once physical
-- confirmation lands, without any heuristic (device_id + approximate
-- timestamp). Additive and nullable -- only ever set for device.* actions;
-- every other action type (visitor/maintenance/notification) leaves it
-- null, unchanged from today.
alter table if exists automation_approvals
  add column if not exists device_command_execution_id text;

create index if not exists automation_approvals_device_command_execution_id_idx
  on automation_approvals (device_command_execution_id)
  where device_command_execution_id is not null;
