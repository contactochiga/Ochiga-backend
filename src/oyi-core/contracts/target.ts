/**
 * Facility Spatial Mode Convergence -- canonical identity semantics
 * (deliberate, do not overload or redefine):
 *
 * - `canonical_id` (this type) is Backend's own RESOLVED canonical entity
 *   identity for the current conversation turn -- currently the row's own
 *   UUID (see e.g. `src/oyi-core/domains/devices/deviceEvidence.ts`'s
 *   `canonical_id: String(device.id)`). It is transient/runtime-scoped: a
 *   fresh CanonicalTarget is built per turn by the interpretation/
 *   orchestration layer, not persisted as a stable cross-system reference.
 *
 * - `canonical_ref` (a DB column on `homes`/`rooms`/`devices`, see
 *   supabase/migrations/20260915090100_home_canonical_ref.sql and its
 *   sibling migrations) is a DIFFERENT, complementary identity: a stable,
 *   human/system-readable, persisted cross-system reference string (e.g.
 *   "LUNA-L06-APT-A"), used by Building Ingestion, Facility spatial
 *   binding and the Twin Engine to address the same real-world object
 *   across systems without depending on Backend's own UUIDs.
 *
 * Resolution direction is: Twin `CanonicalRef` / Backend `canonical_ref`
 * -> Backend canonical entity (the actual homes/rooms/devices row) ->
 * `CanonicalTarget.canonical_id` for that entity. A `canonical_ref`
 * string is never itself substituted for `canonical_id`, and `canonical_id`
 * is never assumed to equal a Twin reference string. The resolver that
 * performs this lookup is intentionally NOT implemented in this slice --
 * see docs/OYI_DIGITAL_TWIN_ASSET_CONTRACT.md for the full design and the
 * Facility Spatial Mode Convergence plan for the resolver's own future
 * slice.
 */
export type CanonicalTarget = {
  object_type: string;
  canonical_id: string;
  label: string | null;
  parent_id?: string | null;
  channel_code?: string | null;
  room_id?: string | null;
  home_id?: string | null;
  estate_id?: string | null;
};

export type TargetSource =
  | "active_workflow"
  | "current_turn"
  | "current_scope"
  | "valid_reference"
  | "page_context"
  | "thread_memory"
  | "none";
