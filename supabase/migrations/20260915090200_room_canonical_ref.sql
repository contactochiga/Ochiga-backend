-- Facility Spatial Mode Convergence, Foundation Slice 1.
-- Promoted from supabase/migrations/20260905030000_LOCAL_TEST_room_canonical_ref.sql
-- (local-only test migration, reviewed, SQL semantics unchanged).
--
-- Purpose: give each room a stable, explicitly-persisted identifier that
-- can later be mirrored 1:1 onto SketchUp/GLB object names, mirroring the
-- exact same pattern applied to homes.canonical_ref (20260915090100). See
-- that migration's header for the canonical_ref vs. CanonicalTarget
-- identity-semantics distinction.
--
-- Audit finding: scripts/pilot-import.mjs already accepts a room_ref
-- column in rooms.csv, but previously stored it only inside the
-- ai_profile jsonb blob (ai_profile.room_ref) -- never as a real,
-- indexed, unique column. This completes that already-referenced field
-- as first-class data instead of leaving it buried in JSON.
--
-- Backward compatibility: nullable, no default, no NOT NULL constraint.
-- Every existing room keeps working unchanged with canonical_ref = NULL.
--
-- Uniqueness: partial unique index (where canonical_ref is not null),
-- same reasoning as uq_homes_canonical_ref -- unlimited NULLs allowed,
-- uniqueness enforced only among rooms that do set an explicit value.
--
-- No new FK is introduced: rooms.home_id already exists and, combined
-- with homes.zone_id/building_id (20260915090000), is sufficient to
-- derive the full Estate -> Building -> Zone -> Home -> Room traversal.

alter table if exists rooms
  add column if not exists canonical_ref text;

create unique index if not exists uq_rooms_canonical_ref
  on rooms (canonical_ref)
  where canonical_ref is not null;

-- Reversal (kept here for review, not executed automatically):
--   drop index if exists uq_rooms_canonical_ref;
--   alter table rooms drop column if exists canonical_ref;
