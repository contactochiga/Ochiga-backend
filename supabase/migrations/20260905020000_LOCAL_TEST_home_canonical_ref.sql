-- LOCAL-ONLY TEST MIGRATION -- Luna Residences Phase 2, canonical
-- digital-twin identity for homes.
-- NOT pushed to production. Not run via `supabase db push`. Applied only
-- against the local Docker Supabase instance for digital-twin hierarchy
-- validation. Pending explicit review before this is ever considered for
-- a real, committed migration.
--
-- Purpose: give each home a stable, explicitly-persisted identifier that
-- can later be mirrored 1:1 onto SketchUp/GLB object names, independent
-- of any human-readable label (name/unit/floor). Those labels may be
-- renamed by an operator; canonical_ref must not change when they do, and
-- must never be derived at runtime from them.
--
-- Backward compatibility: nullable, no default, no NOT NULL constraint.
-- Every existing home (local or production) keeps working unchanged with
-- canonical_ref = NULL.
--
-- Uniqueness: a partial unique index (`where canonical_ref is not null`)
-- so two homes can never accidentally share the same explicit reference,
-- while any number of homes may still have canonical_ref = NULL (a
-- bare "is unique" constraint would instead only ever allow ONE NULL row
-- in total, which would break every other estate's homes the first time
-- a second one was inserted -- the partial form is the correct one here).

alter table if exists homes
  add column if not exists canonical_ref text;

create unique index if not exists uq_homes_canonical_ref
  on homes (canonical_ref)
  where canonical_ref is not null;

-- Reversal (kept here for review, not executed automatically):
--   drop index if exists uq_homes_canonical_ref;
--   alter table homes drop column if exists canonical_ref;
