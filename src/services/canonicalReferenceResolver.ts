// Facility Spatial Mode Convergence, Foundation Slice 2.
//
// The canonical reference resolver: canonical_ref -> Backend canonical
// entity. This is the bridge referenced (but deliberately not built) by
// Foundation Slice 1's identity doc-comment in
// src/oyi-core/contracts/target.ts -- Twin CanonicalRef / Backend
// canonical_ref resolves to a Backend entity, whose id is
// CanonicalTarget.canonical_id for that entity. This module does not
// mutate CanonicalTarget, does not invent canonical refs, and is not a
// second registry: it reads the same homes/rooms/devices rows every other
// Facility route already reads.
//
// Scope safety: every query below is filtered by estate_id. Callers MUST
// supply an estateId that has already been authorized for the requesting
// user (e.g. via the same estate_memberships / req.user.estate_id checks
// already used throughout facility.controller.ts and
// platformGapService.scopedEstate) -- this module does not perform that
// authorization itself, so a canonical_ref belonging to another estate is
// simply never found, never a 403 that would confirm its existence.
import { supabaseAdmin } from "../supabase/supabaseClient";

export type CanonicalRefEntityType = "home" | "room" | "device";
export type CanonicalRefResolutionStatus = "resolved" | "not_found" | "ambiguous";

export type CanonicalRefScope = {
  estate_id: string | null;
  building_id: string | null;
  home_id: string | null;
  room_id: string | null;
};

export type CanonicalRefResolution = {
  canonical_ref: string;
  canonical_id: string | null;
  entity_type: CanonicalRefEntityType | null;
  scope: CanonicalRefScope;
  status: CanonicalRefResolutionStatus;
};

function unresolvedScope(): CanonicalRefScope {
  return { estate_id: null, building_id: null, home_id: null, room_id: null };
}

function unresolved(canonical_ref: string, status: CanonicalRefResolutionStatus): CanonicalRefResolution {
  return { canonical_ref, canonical_id: null, entity_type: null, scope: unresolvedScope(), status };
}

// homes.canonical_ref / rooms.canonical_ref / devices.canonical_ref exist
// only as migration files today (Foundation Slice 1), not yet applied to
// any deployed database. Until they are applied, every query below fails
// with Postgres "column does not exist" (42703) -- that must resolve as
// "not_found", the same honest null-means-unresolved behavior as a real
// applied-but-empty column, not a 500. This mirrors the exact defensive
// pattern already established in src/routes/me.routes.ts for this same
// not-yet-applied migration.
function isMissingColumnError(error: any): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /column .* does not exist/i.test(String(error.message || ""));
}

async function findBuildingIdForHome(homeId: string | null): Promise<string | null> {
  if (!homeId) return null;
  const { data, error } = await supabaseAdmin.from("homes").select("building_id").eq("id", homeId).maybeSingle();
  if (error && !isMissingColumnError(error)) throw error;
  return (data as any)?.building_id ?? null;
}

/**
 * Resolve a canonical_ref string to its Backend canonical entity, scoped
 * to a single, already-authorized estate. Supports home, room and device
 * -- the entity types the current schema (plus Slice 1's canonical_ref
 * columns) can honestly resolve today. Other entity types are not
 * attempted: estate_buildings/estate_zones have no canonical_ref column,
 * and guessing would violate "do not invent canonical refs for records
 * where none exists."
 *
 * Ambiguity: canonical_ref uniqueness is only enforced per-table (three
 * separate partial unique indexes), so nothing today prevents the same
 * ref string existing in two different tables at once. If that happens
 * this resolver refuses to silently pick one and returns "ambiguous"
 * instead.
 */
export async function resolveCanonicalRef(estateId: string, canonicalRefInput: unknown): Promise<CanonicalRefResolution> {
  const canonical_ref = String(canonicalRefInput || "").trim();
  if (!estateId || !canonical_ref) return unresolved(canonical_ref, "not_found");

  const [homeResult, roomResult, deviceResult] = await Promise.all([
    supabaseAdmin.from("homes").select("id,estate_id,building_id").eq("estate_id", estateId).eq("canonical_ref", canonical_ref).limit(2),
    supabaseAdmin.from("rooms").select("id,estate_id,home_id").eq("estate_id", estateId).eq("canonical_ref", canonical_ref).limit(2),
    supabaseAdmin.from("devices").select("id,estate_id,home_id,room_id").eq("estate_id", estateId).eq("canonical_ref", canonical_ref).limit(2),
  ]);

  for (const result of [homeResult, roomResult, deviceResult]) {
    if (result.error && !isMissingColumnError(result.error)) throw result.error;
  }

  const homes = isMissingColumnError(homeResult.error) ? [] : homeResult.data || [];
  const rooms = isMissingColumnError(roomResult.error) ? [] : roomResult.data || [];
  const devices = isMissingColumnError(deviceResult.error) ? [] : deviceResult.data || [];

  const totalMatches = homes.length + rooms.length + devices.length;
  if (totalMatches === 0) return unresolved(canonical_ref, "not_found");
  if (totalMatches > 1) return unresolved(canonical_ref, "ambiguous");

  if (homes.length === 1) {
    const home = homes[0] as any;
    return {
      canonical_ref,
      canonical_id: String(home.id),
      entity_type: "home",
      status: "resolved",
      scope: { estate_id: home.estate_id ?? null, building_id: home.building_id ?? null, home_id: String(home.id), room_id: null },
    };
  }

  if (rooms.length === 1) {
    const room = rooms[0] as any;
    const building_id = await findBuildingIdForHome(room.home_id ?? null);
    return {
      canonical_ref,
      canonical_id: String(room.id),
      entity_type: "room",
      status: "resolved",
      scope: { estate_id: room.estate_id ?? null, building_id, home_id: room.home_id ?? null, room_id: String(room.id) },
    };
  }

  const device = devices[0] as any;
  const building_id = await findBuildingIdForHome(device.home_id ?? null);
  return {
    canonical_ref,
    canonical_id: String(device.id),
    entity_type: "device",
    status: "resolved",
    scope: { estate_id: device.estate_id ?? null, building_id, home_id: device.home_id ?? null, room_id: device.room_id ?? null },
  };
}
