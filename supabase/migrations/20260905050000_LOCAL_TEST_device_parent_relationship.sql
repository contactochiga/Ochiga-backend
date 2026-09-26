-- LOCAL-ONLY TEST MIGRATION -- Luna Residences Phase 3C structural fix.
-- NOT pushed to production. Not run via `supabase db push`. Applied only
-- against the local Docker Supabase instance for digital-twin hierarchy
-- validation. Pending explicit review before this is ever considered for
-- a real, committed migration.
--
-- Audit finding: nothing in the existing schema expresses device-to-
-- device hierarchy (e.g. a fire detector reporting to a fire alarm
-- panel, a booster pump belonging to a water system, a meter measuring
-- a distribution board's output). devices/facility_cameras/access_points/
-- edge_nodes all model spatial and identity concerns but none model
-- "this operational object is part of / reports to that one."
--
-- Purpose: minimal, additive, self-referential parent/child relationship
-- for building-wide infrastructure assets.
--
-- Backward compatibility: nullable, no default. Every existing device
-- (local or production) keeps working unchanged with parent_device_id =
-- NULL. ON DELETE SET NULL matches this schema's existing convention for
-- optional many-to-one links off devices (see room_id/home_id).

alter table if exists devices
  add column if not exists parent_device_id uuid references devices(id) on delete set null;

create index if not exists idx_devices_parent on devices(parent_device_id);

-- Reversal (kept here for review, not executed automatically):
--   drop index if exists idx_devices_parent;
--   alter table devices drop column if exists parent_device_id;
