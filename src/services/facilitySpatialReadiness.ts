// Facility Spatial Mode Convergence, Foundation Slice 2.
//
// One authoritative resolver answering "what presentation capability does
// this building/estate currently have: Standard Mode only, or Standard +
// Spatial Mode?" Standard Mode is always available -- Spatial Mode is
// additive, per the product decision that Facility is one product with
// two presentation modes.
//
// Evidence honesty (this is the load-bearing design decision of this
// module): twin_models and twin_entity_placements
// (20260602230840_platform_gap_closure_stage_b.sql) carry no heartbeat,
// session, or freshness field -- only a generic updated_at last-edit
// timestamp, and emitSignal's "twin.state.updated" event
// (src/realtime/emitSignal.ts) fires on every write, which is a
// write-audit signal, not evidence of a live Twin Engine connection.
// There is therefore no real evidence anywhere in the current schema that
// a Twin is *operationally connected* right now, only evidence that a
// model was uploaded/processed and that objects were spatially bound.
// twin.operationally_connected is accordingly always false today -- this
// module never fabricates it from updated_at or any other timestamp. The
// "spatial_connected" mode name is kept in the type (for forward
// documentation / the next capability slice that may add a real Twin
// Engine heartbeat) but this resolver never produces it.
import { supabaseAdmin } from "../supabase/supabaseClient";

export type FacilitySpatialReadinessMode =
  | "standard_only"
  | "spatial_preparing"
  | "spatial_available"
  | "spatial_connected"
  | "spatial_temporarily_unavailable";

export type FacilitySpatialReadiness = {
  mode: FacilitySpatialReadinessMode;
  standard_mode_available: true;
  spatial_mode_available: boolean;
  scope: {
    level: "building" | "estate";
    estate_id: string;
    building_id: string | null;
  };
  twin: {
    model_available: boolean;
    bindings_available: boolean;
    operationally_connected: false;
  };
};

type TwinModelRow = { id: string; state: string | null; assigned_scope: string | null; assigned_entity_id: string | null };
type TwinPlacementRow = { id: string; location_state: string | null; building_id: string | null };

/**
 * Resolve Facility Spatial Mode readiness for an estate, optionally
 * scoped to one building within it.
 *
 * Building scoping: twin_models.assigned_entity_id and
 * twin_entity_placements.building_id have no FK constraint (confirmed by
 * inspection of registerModel()/upsertPlacement() in
 * platformGapService.ts, which accept them unvalidated from the request
 * body) -- so building-level readiness is only as trustworthy as whatever
 * wrote those rows, an existing data-integrity characteristic of this
 * schema, not something this resolver can fix. When a buildingId is
 * given, only rows explicitly scoped to it (assigned_scope="building" +
 * matching assigned_entity_id, or a matching placements.building_id) or
 * explicitly estate-wide (assigned_scope="estate", which by definition
 * covers every building) count as evidence -- a placement with no
 * building_id at all is never counted as evidence for a *specific*
 * building, to avoid inflating one building's readiness from unrelated
 * or not-yet-scoped data.
 */
export async function resolveFacilitySpatialReadiness(estateId: string, buildingId?: string | null): Promise<FacilitySpatialReadiness> {
  const scopedToBuilding = Boolean(buildingId);

  const [modelsResult, placementsResult] = await Promise.all([
    supabaseAdmin.from("twin_models").select("id,state,assigned_scope,assigned_entity_id").eq("estate_id", estateId),
    supabaseAdmin.from("twin_entity_placements").select("id,location_state,building_id").eq("estate_id", estateId),
  ]);
  if (modelsResult.error) throw modelsResult.error;
  if (placementsResult.error) throw placementsResult.error;

  const allModels = (modelsResult.data || []) as TwinModelRow[];
  const allPlacements = (placementsResult.data || []) as TwinPlacementRow[];

  const models = scopedToBuilding
    ? allModels.filter((m) => m.assigned_scope === "estate" || (m.assigned_scope === "building" && m.assigned_entity_id === buildingId))
    : allModels;
  const placements = scopedToBuilding ? allPlacements.filter((p) => p.building_id === buildingId) : allPlacements;

  const hasAnyModel = models.length > 0;
  const hasAvailableModel = models.some((m) => m.state === "available");
  const hasOnlyFailedModels = hasAnyModel && models.every((m) => m.state === "failed");
  const hasBindings = placements.some((p) => p.location_state === "location_assigned");

  let mode: FacilitySpatialReadinessMode;
  if (!hasAnyModel) mode = "standard_only";
  else if (hasOnlyFailedModels) mode = "spatial_temporarily_unavailable";
  else if (!hasAvailableModel) mode = "spatial_preparing";
  else if (!hasBindings) mode = "spatial_preparing";
  else mode = "spatial_available";

  return {
    mode,
    standard_mode_available: true,
    spatial_mode_available: mode === "spatial_available",
    scope: { level: scopedToBuilding ? "building" : "estate", estate_id: estateId, building_id: buildingId || null },
    twin: {
      model_available: hasAvailableModel,
      bindings_available: hasBindings,
      operationally_connected: false,
    },
  };
}
