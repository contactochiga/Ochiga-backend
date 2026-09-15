-- Facility Spatial Mode Convergence, Foundation Slice 1.
-- Promoted from supabase/migrations/20260905010000_LOCAL_TEST_home_zone_building_link.sql
-- (local-only test migration, reviewed, SQL semantics unchanged) -- see
-- that file for the original local-Docker validation history and
-- docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md for the broader identity design.
--
-- Purpose: let a home/unit be structurally associated with its
-- estate_zone (floor/level) and its estate_building, instead of only the
-- free-text `block` string match that scripts/pilot-import.mjs previously
-- relied on.
--
-- Backward compatibility: both new columns are nullable with no default
-- and no NOT NULL constraint. Every existing home keeps working unchanged
-- with zone_id/building_id = NULL. Nothing about this migration requires
-- backfilling any existing row.
--
-- Cascade behavior: ON DELETE SET NULL for zone_id, matching this
-- schema's own existing convention for optional many-to-one links off
-- `homes` (see fk_homes_resident_id, also ON DELETE SET NULL). Deleting a
-- zone (e.g. restructuring a floor) must never delete the homes that sit
-- on it -- only clear the reference.

alter table if exists homes
  add column if not exists zone_id uuid references estate_zones(id) on delete set null;

create index if not exists idx_homes_zone_id on homes(zone_id);

-- building_id: this column and its ON DELETE SET NULL FK to
-- estate_buildings already exist in production (added by
-- 20260716234055_infrastructure_onboarding_engine.sql). Re-declared here
-- idempotently (if not exists) purely so this migration is self-contained
-- and safe to replay against any environment, production included -- it
-- is a genuine no-op against a database that already has the column.
alter table if exists homes
  add column if not exists building_id uuid references estate_buildings(id) on delete set null;

create index if not exists idx_homes_building_id on homes(building_id);

-- floor: verified absent from every other migration in this repository
-- (schema.sql and supabase/migrations/*) before adding it here. The
-- Facility frontend (FacilityStructureWorkspace.tsx: floorLabel()) already
-- reads `home.floor ?? home.block`, i.e. it already expects this field
-- and silently falls back to `block` today because `floor` has never
-- actually existed. This completes that already-referenced field rather
-- than introducing a competing concept. Kept as free text (not a zone_id
-- duplicate) because it is the *human-readable* label ("Floor 6",
-- "Penthouse") the frontend displays, deliberately independent of the
-- canonical_ref identifier (20260915090100) and independent of the
-- structural zone_id relationship added above.
alter table if exists homes
  add column if not exists floor text;
