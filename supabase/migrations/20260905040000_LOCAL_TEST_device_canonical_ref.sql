-- LOCAL-ONLY TEST MIGRATION -- Luna Residences Phase 3B structural fix.
-- NOT pushed to production. Not run via `supabase db push`. Applied only
-- against the local Docker Supabase instance for digital-twin hierarchy
-- validation. Pending explicit review before this is ever considered for
-- a real, committed migration.
--
-- Audit finding: devices.external_id already exists (not null, unique
-- per estate+adapter+external_id) but it is the VENDOR's device
-- identifier -- for real hardware it is assigned by Tuya/BLE/MQTT at
-- pairing time and has no relationship to our own naming. Reusing it as
-- the digital-twin identity would (a) conflate two different concerns
-- and (b) for simulated/placeholder devices, force a fabricated
-- vendor-style ID just to satisfy NOT NULL -- which risks implying real
-- hardware connectivity that does not exist. scripts/pilot-import.mjs
-- also already accepted a device_ref per row, but stored it only inside
-- metadata.device_ref (jsonb) -- the same "referenced but never
-- persisted as first-class data" pattern already fixed on homes and
-- rooms in Phase 2/3A.
--
-- Purpose: give each device/asset a stable, explicitly-persisted
-- identifier independent of vendor external_id, for 1:1 SketchUp/GLB
-- object-name mirroring.
--
-- Backward compatibility: nullable, no default, no NOT NULL constraint.
-- Every existing device (local or production) keeps working unchanged
-- with canonical_ref = NULL.
--
-- Uniqueness: partial unique index, same reasoning as
-- uq_homes_canonical_ref / uq_rooms_canonical_ref.

alter table if exists devices
  add column if not exists canonical_ref text;

create unique index if not exists uq_devices_canonical_ref
  on devices (canonical_ref)
  where canonical_ref is not null;

-- Reversal (kept here for review, not executed automatically):
--   drop index if exists uq_devices_canonical_ref;
--   alter table devices drop column if exists canonical_ref;
