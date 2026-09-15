-- Facility Spatial Mode Convergence, Foundation Slice 1.
-- Promoted from supabase/migrations/20260905020000_LOCAL_TEST_home_canonical_ref.sql
-- (local-only test migration, reviewed, SQL semantics unchanged).
--
-- Identity semantics (see docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md and the
-- Facility Spatial Mode Convergence plan): `canonical_ref` is the stable,
-- cross-system spatial/asset reference used by Building Ingestion, Twin
-- and Facility spatial binding (e.g. "LUNA-L06-APT-A") -- explicitly
-- DISTINCT from CanonicalTarget.canonical_id in src/oyi-core, which is a
-- transient, conversation-turn-scoped identifier (currently the row's own
-- UUID). A home's canonical_ref is resolved to its backend canonical
-- entity, whose canonical_id is derived from that resolution -- the
-- resolver itself is deliberately not built in this slice.
--
-- Purpose: give each home a stable, explicitly-persisted identifier that
-- can later be mirrored 1:1 onto SketchUp/GLB object names, independent
-- of any human-readable label (name/unit/floor). Those labels may be
-- renamed by an operator; canonical_ref must not change when they do, and
-- must never be derived at runtime from them.
--
-- Backward compatibility: nullable, no default, no NOT NULL constraint.
-- Every existing home keeps working unchanged with canonical_ref = NULL.
--
-- Uniqueness: a partial unique index (`where canonical_ref is not null`)
-- so two homes can never accidentally share the same explicit reference,
-- while any number of homes may still have canonical_ref = NULL (a bare
-- "is unique" constraint would instead only ever allow ONE NULL row in
-- total, which would break every other estate's homes the first time a
-- second one was inserted -- the partial form is the correct one here).

alter table if exists homes
  add column if not exists canonical_ref text;

create unique index if not exists uq_homes_canonical_ref
  on homes (canonical_ref)
  where canonical_ref is not null;

-- Reversal (kept here for review, not executed automatically):
--   drop index if exists uq_homes_canonical_ref;
--   alter table homes drop column if exists canonical_ref;
