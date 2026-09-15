// Facility Spatial Mode Convergence, Foundation Slice 3 -- Spatial Facility
// Read Path.
//
// Proves one architectural principle: a spatially selected canonical
// object resolves into the EXACT SAME live Facility operational truth
// Standard Mode already sees, without a second state store or a second
// Facility backend. This module owns no state of its own -- it is a
// bounded, permission-aware PROJECTION over the same authoritative
// services/tables every Standard Facility route already reads:
//   - CanonicalReferenceResolver (Slice 2) for identity
//   - deviceRuntimeStateService for live device runtime truth
//   - deviceProjectionService for Facility device visibility/capability
//   - platformGapService.incidents for facility_incidents
//   - modules/cameras/cameraAccess.policy for camera visibility
//   - homes/rooms/devices/maintenance_requests tables directly, using the
//     same columns and estate/home/room scope columns those tables'
//     existing controllers already select
//
// It answers "what Facility object does this spatial reference represent,
// and what operational truth may this actor currently see about it?" --
// never "what does this mean?" (that remains Oyi Core's job).
import { supabaseAdmin } from "../supabase/supabaseClient";
import { hasPermission } from "../core/foundation";
import type { AuthUser } from "../middleware/auth";
import { resolveCanonicalRef, type CanonicalRefEntityType } from "./canonicalReferenceResolver";
import { CANONICAL_DEVICE_SELECT } from "./canonicalDeviceReadResolver";
import { deviceRuntimeStateService } from "./deviceRuntimeStateService";
import { canFacilityViewDevice, canFacilityControlDevice, projectDeviceForSurface } from "./deviceProjectionService";
import { platformGapService } from "./platformGapService";
import { canAccessCamera, cameraHomeId } from "../modules/cameras/cameraAccess.policy";
import { sanitizeCameraRecord } from "../modules/cameras/cameraSerialization";
import { withCanonicalCameraHealth } from "../modules/cameras/cameraHealth";

export type SpatialContextResolutionStatus = "resolved" | "not_found" | "ambiguous";

// A bounded, actor-scoped view of one related-record domain. `permitted:
// false` means the actor's own Facility permissions -- not this service --
// blocked the domain; `items` is omitted in that case so absence is never
// mistaken for "zero records" (Section 6's non-negotiable: twin.view must
// never become a bypass for an underlying domain permission).
export type BoundedRecordSet<T> =
  | { permitted: true; available: boolean; items: T[] }
  | { permitted: false; reason: string };

export type SpatialFacilityContext = {
  canonical_ref: string;
  canonical_id: string;
  entity_type: CanonicalRefEntityType;
  identity: Record<string, any>;
  scope: { estate_id: string; building_id: string | null; home_id: string | null; room_id: string | null };
  operational_state: Record<string, any> | null;
  related_operational_records: {
    maintenance?: BoundedRecordSet<Record<string, any>>;
    incidents?: BoundedRecordSet<Record<string, any>>;
    devices?: BoundedRecordSet<Record<string, any>>;
    cameras?: BoundedRecordSet<Record<string, any>>;
  };
  available_capabilities: string[];
  source: { resolved_via: "canonical_reference_resolver"; entity_query: "live"; generated_at: string };
};

export type SpatialFacilityContextResult =
  | { status: "resolved"; context: SpatialFacilityContext }
  | { status: "not_found" }
  | { status: "ambiguous" }
  | { status: "permission_denied"; domain: string; permission: string };

function nowIso() {
  return new Date().toISOString();
}

function deniedRecordSet(permission: string): BoundedRecordSet<never> {
  return { permitted: false, reason: `insufficient_permission:${permission}` };
}

// Bounded maintenance summary for a home/room. No authoritative
// home/room-scoped maintenance service exists today (listFacilityMaintenance
// in maintenance.controller.ts is estate-wide only) -- this reuses the exact
// same table, columns and gating permission (support.read) that controller
// already uses, narrowing with the one additional scope filter a bounded
// spatial context requires. It does not reimplement status transitions,
// assignment, or any other maintenance business logic.
async function boundedMaintenance(estateId: string, homeId: string | null, roomId: string | null, actor: AuthUser | null): Promise<BoundedRecordSet<Record<string, any>>> {
  if (!hasPermission(actor, "support.read")) return deniedRecordSet("support.read");
  let query = supabaseAdmin.from("maintenance_requests").select("id,title,status,priority,assigned_to,created_at,updated_at").eq("estate_id", estateId).order("created_at", { ascending: false }).limit(20);
  if (roomId) query = query.eq("room_id", roomId);
  else if (homeId) query = query.eq("home_id", homeId);
  const { data, error } = await query;
  if (error) throw error;
  const closed = new Set(["completed", "resolved", "closed", "cancelled"]);
  const items = (data || []).filter((row: any) => !closed.has(String(row.status || "").toLowerCase()));
  return { permitted: true, available: items.length > 0, items };
}

// Bounded incident summary for a home/room, reusing
// platformGapService.incidents(req) verbatim (the same estate-scoped query
// Standard Facility's incidents view already runs) via a minimal
// request-shaped object, then narrowing in-memory to this home/room --
// facility_incidents has no home/room-scoped query today, only estate-wide.
async function boundedIncidents(estateId: string, homeId: string | null, roomId: string | null, actor: AuthUser | null): Promise<BoundedRecordSet<Record<string, any>>> {
  if (!hasPermission(actor, "support.read")) return deniedRecordSet("support.read");
  const pseudoReq = { query: { estate_id: estateId, status: "open", limit: "120" }, body: {}, user: actor } as any;
  const result = await platformGapService.incidents(pseudoReq);
  const items = (result.items || []).filter((row: any) => {
    if (roomId) return String(row.room_id || "") === roomId;
    if (homeId) return String(row.home_id || "") === homeId;
    return true;
  });
  return { permitted: true, available: items.length > 0, items };
}

// Bounded device list for a home/room, using the same devices table +
// Facility visibility/capability policy (deviceProjectionService) the
// Facility device registry route already composes.
async function boundedDevices(estateId: string, homeId: string | null, roomId: string | null, actor: AuthUser | null): Promise<BoundedRecordSet<Record<string, any>>> {
  if (!hasPermission(actor, "devices.read")) return deniedRecordSet("devices.read");
  let query = supabaseAdmin.from("devices").select(CANONICAL_DEVICE_SELECT).eq("estate_id", estateId);
  if (roomId) query = query.eq("room_id", roomId);
  else if (homeId) query = query.eq("home_id", homeId);
  const { data, error } = await query;
  if (error) throw error;
  const items = (data || [])
    .filter((device: any) => canFacilityViewDevice(device, actor || {}))
    .map((device: any) => {
      const projected = projectDeviceForSurface(device, { actor: actor || {}, surface: "facility" });
      return { id: device.id, name: device.name, type: device.type, category: device.category, online: device.online, status: device.status, projection: projected.projection };
    });
  return { permitted: true, available: items.length > 0, items };
}

// Bounded camera list for a home, reusing the same canAccessCamera policy
// and sanitization/health-projection helpers camerasController.listByHome
// already uses -- estate-scoped fetch, then the identical per-camera
// authority check, narrowed to this home via cameraHomeId().
async function boundedCameras(estateId: string, homeId: string | null, actor: AuthUser | null): Promise<BoundedRecordSet<Record<string, any>>> {
  if (!hasPermission(actor, "cameras.view")) return deniedRecordSet("cameras.view");
  if (!homeId) return { permitted: true, available: false, items: [] };
  const { data, error } = await supabaseAdmin.from("facility_cameras").select("*").eq("estate_id", estateId);
  if (error) throw error;
  const items = (data || [])
    .filter((camera: any) => cameraHomeId(camera) === homeId && canAccessCamera(camera, actor as any).ok)
    .map((camera: any) => sanitizeCameraRecord(withCanonicalCameraHealth(camera)));
  return { permitted: true, available: items.length > 0, items };
}

async function buildDeviceContext(canonicalId: string, canonicalRef: string, estateId: string, actor: AuthUser | null): Promise<SpatialFacilityContextResult> {
  if (!hasPermission(actor, "devices.read")) return { status: "permission_denied", domain: "device", permission: "devices.read" };
  const { data: device, error } = await supabaseAdmin.from("devices").select(CANONICAL_DEVICE_SELECT).eq("id", canonicalId).eq("estate_id", estateId).maybeSingle();
  if (error) throw error;
  if (!device) return { status: "not_found" };
  if (!canFacilityViewDevice(device, actor || {})) return { status: "permission_denied", domain: "device", permission: "devices.read" };

  const runtime = await deviceRuntimeStateService.getOrHydrate(device).catch(() => null);
  const canControl = canFacilityControlDevice(device, actor || {});

  const operational_state = runtime
    ? {
        online: (runtime.state as any)?.online ?? device.online ?? null,
        summary: runtime.summary,
        freshness: runtime.freshness,
        stale: runtime.stale,
        age_ms: runtime.age_ms,
        source: runtime.source,
        provider_error: runtime.provider_error,
        authorization_state: runtime.authorization_state,
        last_refresh: runtime.last_refresh,
      }
    : { online: device.online ?? null, summary: null, freshness: "unavailable", stale: true, source: "unavailable", note: "runtime hydration unavailable" };

  const context: SpatialFacilityContext = {
    canonical_ref: canonicalRef,
    canonical_id: canonicalId,
    entity_type: "device",
    identity: { name: device.name, type: device.type, category: device.category, adapter: device.adapter, vendor: device.vendor },
    scope: { estate_id: estateId, building_id: null, home_id: device.home_id || null, room_id: device.room_id || null },
    operational_state,
    related_operational_records: {},
    available_capabilities: canControl ? ["view", "control"] : ["view"],
    source: { resolved_via: "canonical_reference_resolver", entity_query: "live", generated_at: nowIso() },
  };
  return { status: "resolved", context };
}

async function buildHomeOrRoomContext(
  entityType: "home" | "room",
  canonicalId: string,
  canonicalRef: string,
  estateId: string,
  actor: AuthUser | null,
): Promise<SpatialFacilityContextResult> {
  if (!hasPermission(actor, "homes.read")) return { status: "permission_denied", domain: entityType, permission: "homes.read" };

  const table = entityType === "home" ? "homes" : "rooms";
  const select = entityType === "home" ? "id,name,unit,block,floor,type,building_id,zone_id,estate_id,canonical_ref" : "id,name,type,floor,home_id,estate_id,canonical_ref";
  const { data: row, error } = await supabaseAdmin.from(table).select(select).eq("id", canonicalId).eq("estate_id", estateId).maybeSingle();
  if (error) throw error;
  if (!row) return { status: "not_found" };

  const homeId = entityType === "home" ? String((row as any).id) : String((row as any).home_id || "") || null;
  const roomId = entityType === "room" ? String((row as any).id) : null;
  const buildingId = entityType === "home" ? (row as any).building_id || null : null;

  // Cameras have no room-level scoping anywhere in this schema (only
  // facility_cameras.home_id) -- for a room context this intentionally
  // passes null rather than the parent home's id, so the result honestly
  // reports "not available at room granularity" (available: false) for a
  // permitted actor, instead of either leaking the whole home's cameras
  // into a narrower room context or misreporting a scope limitation as a
  // permission denial.
  const [maintenance, incidents, devices, cameras] = await Promise.all([
    boundedMaintenance(estateId, homeId, roomId, actor),
    boundedIncidents(estateId, homeId, roomId, actor),
    boundedDevices(estateId, homeId, roomId, actor),
    boundedCameras(estateId, entityType === "home" ? homeId : null, actor),
  ]);

  const context: SpatialFacilityContext = {
    canonical_ref: canonicalRef,
    canonical_id: canonicalId,
    entity_type: entityType,
    identity: entityType === "home"
      ? { name: (row as any).name, unit: (row as any).unit, block: (row as any).block, floor: (row as any).floor, type: (row as any).type }
      : { name: (row as any).name, type: (row as any).type, floor: (row as any).floor },
    scope: { estate_id: estateId, building_id: buildingId, home_id: homeId, room_id: roomId },
    operational_state: null,
    related_operational_records: { maintenance, incidents, devices, cameras },
    available_capabilities: ["view"],
    source: { resolved_via: "canonical_reference_resolver", entity_query: "live", generated_at: nowIso() },
  };
  return { status: "resolved", context };
}

/**
 * Resolve a canonical_ref into a bounded, permission-aware Facility read
 * context. estateId must already be authorized for the caller (mirrors
 * every other Slice 2/3 entry point -- this function does not itself
 * decide estate scope, only enforces it as a hard filter).
 */
export async function resolveSpatialFacilityContext(estateId: string, canonicalRef: string, actor: AuthUser | null): Promise<SpatialFacilityContextResult> {
  const resolution = await resolveCanonicalRef(estateId, canonicalRef);
  if (resolution.status === "not_found") return { status: "not_found" };
  if (resolution.status === "ambiguous") return { status: "ambiguous" };
  if (!resolution.canonical_id || !resolution.entity_type) return { status: "not_found" };

  if (resolution.entity_type === "device") {
    return buildDeviceContext(resolution.canonical_id, resolution.canonical_ref, estateId, actor);
  }
  return buildHomeOrRoomContext(resolution.entity_type, resolution.canonical_id, resolution.canonical_ref, estateId, actor);
}
