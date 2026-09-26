-- LOCAL-ONLY TEST MIGRATION -- Luna Residences Phase 2 structural fix.
-- NOT pushed to production. Not run via `supabase db push`. Applied only
-- against the local Docker Supabase instance for digital-twin hierarchy
-- validation. Pending explicit review before this is ever considered for
-- a real, committed migration.
--
-- Purpose: let a home/unit be structurally associated with its
-- estate_zone (floor/level) and its estate_building, instead of only the
-- free-text `block` string match that scripts/pilot-import.mjs currently
-- relies on.
--
-- Backward compatibility: both new columns are nullable with no default
-- and no NOT NULL constraint. Every existing home (local or production)
-- keeps working unchanged with zone_id/building_id = NULL. Nothing about
-- this migration requires backfilling any existing row.
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
-- 20260716234055_infrastructure_onboarding_engine.sql) but that migration
-- is not part of this local test instance's minimal replay set, and
-- scripts/pilot-import.mjs has never actually populated it (it only ever
-- wrote the free-text `block` column). Re-declaring it here (idempotent,
-- if not exists) so the local instance matches the real column shape and
-- the Phase 2 import path can start populating it correctly.
alter table if exists homes
  add column if not exists building_id uuid references estate_buildings(id) on delete set null;

create index if not exists idx_homes_building_id on homes(building_id);

-- floor: audited first -- no `floor` column exists on `homes` in any
-- migration in this repository (schema.sql or supabase/migrations). The
-- facility-oyi frontend (FacilityStructureWorkspace.tsx: floorLabel())
-- already reads `home.floor ?? home.block`, i.e. it already expects this
-- field and silently falls back to `block` today because `floor` has
-- never actually existed. This completes that already-referenced field
-- rather than introducing a competing concept. Kept as free text (not a
-- zone_id duplicate) because it is the *human-readable* label ("Floor 6",
-- "Penthouse") the frontend displays, deliberately independent of the
-- canonical home_ref identifier and independent of the structural
-- zone_id relationship added above.
alter table if exists homes
  add column if not exists floor text;
