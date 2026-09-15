-- Facility Spatial Mode Convergence, Foundation Slice 1.
-- Promoted from supabase/migrations/20260905040000_LOCAL_TEST_device_canonical_ref.sql
-- (local-only test migration, reviewed, SQL semantics unchanged).
--
-- Audit finding: devices.external_id already exists (not null, unique per
-- estate+adapter+external_id -- see uq_devices_estate_adapter_external,
-- 20260521000100_pilot_onboarding_foundation.sql) but it is the VENDOR's
-- device identifier -- for real hardware it is assigned by Tuya/BLE/MQTT
-- at pairing time and has no relationship to our own naming. Reusing it
-- as the digital-twin identity would (a) conflate two different concerns
-- and (b) for simulated/placeholder devices, force a fabricated
-- vendor-style ID just to satisfy NOT NULL -- which risks implying real
-- hardware connectivity that does not exist. scripts/pilot-import.mjs
-- also already accepted a device_ref per row, but stored it only inside
-- metadata.device_ref (jsonb) -- the same "referenced but never persisted
-- as first-class data" pattern already fixed on homes and rooms.
--
-- Purpose: give each device/asset a stable, explicitly-persisted
-- identifier independent of vendor external_id, for 1:1 SketchUp/GLB
-- object-name mirroring. See 20260915090100's header for the
-- canonical_ref vs. CanonicalTarget identity-semantics distinction.
--
-- Backward compatibility: nullable, no default, no NOT NULL constraint.
-- Every existing device keeps working unchanged with canonical_ref = NULL.
--
-- Uniqueness: partial unique index, same reasoning as
-- uq_homes_canonical_ref / uq_rooms_canonical_ref.
--
-- Scope note: this migration does NOT include devices.parent_device_id.
-- That column was proposed in the equivalent LOCAL_TEST migration
-- (20260905050000_LOCAL_TEST_device_parent_relationship.sql) under the
-- stated premise that no device-to-device hierarchy existed in the
-- schema -- that premise is incorrect. `devices.parent_device_id` (plus a
-- companion `is_virtual` boolean and a named FK
-- `devices_parent_device_id_fkey`) already exists in production, added by
-- 20260710000100_ir_virtual_appliances.sql and repaired by
-- 20260710000200_repair_ir_device_schema.sql, for IR virtual-appliance ->
-- physical-blaster relationships. Reusing that same column for a general
-- infrastructure parent/child relationship (detector -> fire panel, pump
-- -> water system) would silently overload one column with two distinct
-- semantic meanings with no way to distinguish them. This conflict is
-- reported in full in this slice's completion report rather than resolved
-- here; no parent_device_id migration is promoted in this slice.

alter table if exists devices
  add column if not exists canonical_ref text;

create unique index if not exists uq_devices_canonical_ref
  on devices (canonical_ref)
  where canonical_ref is not null;

-- Reversal (kept here for review, not executed automatically):
--   drop index if exists uq_devices_canonical_ref;
--   alter table devices drop column if exists canonical_ref;
