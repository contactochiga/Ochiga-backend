import type { AuthUser } from "../middleware/auth";
import { logger } from "../observability/logger";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { deviceReadScopeCache } from "./deviceReadScopeCache";
import {
  isTechnicalDeviceHiddenFromResidents,
  resolveCanonicalIrChildForProviderRemote,
} from "./deviceInventoryVisibility";

export const CANONICAL_DEVICE_SELECT = "id,name,estate_id,home_id,room_id,parent_device_id,is_virtual,external_id,vendor,provider,adapter,online,status,type,category,capabilities,metadata,last_seen_at,last_event_at,updated_at";
export const CANONICAL_DEVICE_SNAPSHOT_SELECT = "device_states(device_id,status,last_seen,updated_at)";

export type CanonicalDeviceReadResolutionStatus =
  | "hydrated"
  | "not_found"
  | "scope_mismatch"
  | "permission_denied"
  | "query_failed"
  | "hidden";

export type CanonicalDeviceReadResolution =
  | {
      status: "hydrated";
      device: Record<string, any>;
      snapshot: Record<string, any> | null;
      databaseRoundTrips: number;
      resolutionSource: "scope_cache" | "database";
    }
  | {
      status: Exclude<CanonicalDeviceReadResolutionStatus, "hydrated">;
      device: null;
      snapshot: null;
      databaseRoundTrips: number;
      resolutionSource: "scope_cache" | "database" | "none";
      reason: string;
      error_code?: string | null;
    };

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function relatedSnapshot(value: unknown) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

async function homeBelongsToEstate(homeId: string | null, estateId: string | null) {
  if (!homeId || !estateId) return true;
  const { data, error } = await supabaseAdmin
    .from("homes")
    .select("id,estate_id")
    .eq("id", homeId)
    .maybeSingle();
  if (error) throw error;
  return String((data as any)?.estate_id || "") === String(estateId);
}

function actorCanReadDevice(actor: AuthUser | null | undefined, device: Record<string, any>, homeId: string | null, estateId: string | null) {
  if (!actor) return true;
  if (actor.role === "system_admin" || actor.role === "estate_admin") return true;
  const actorHomeId = String((actor as any).home_id || "").trim();
  const actorEstateId = String((actor as any).estate_id || "").trim();
  if (homeId && actorHomeId && actorHomeId !== homeId) return false;
  if (homeId && device.home_id && String(device.home_id) !== homeId) return false;
  if (!homeId && estateId && actorEstateId && actorEstateId !== estateId) return false;
  return true;
}

async function validateResolvedDevice(input: {
  actor?: AuthUser | null;
  device: Record<string, any>;
  activeHomeId: string | null;
  activeEstateId: string | null;
  surface?: string | null;
  source?: string | null;
}) {
  let device = input.device;
  const canonicalChild = await resolveCanonicalIrChildForProviderRemote(device);
  if (canonicalChild?.id) device = canonicalChild;
  if (isTechnicalDeviceHiddenFromResidents(device)) {
    return { status: "hidden" as const, reason: "technical_provider_object_hidden", device: null };
  }
  if (input.activeHomeId && String(device.home_id || "") !== String(input.activeHomeId)) {
    return { status: "scope_mismatch" as const, reason: "device_outside_active_home", device: null };
  }
  const homeOk = await homeBelongsToEstate(input.activeHomeId || String(device.home_id || "") || null, input.activeEstateId);
  if (!homeOk) {
    return { status: "scope_mismatch" as const, reason: "active_home_outside_active_estate", device: null };
  }
  if (!actorCanReadDevice(input.actor, device, input.activeHomeId, input.activeEstateId)) {
    return { status: "permission_denied" as const, reason: "actor_cannot_read_device", device: null };
  }
  deviceReadScopeCache.set(device);
  return { status: "hydrated" as const, reason: null, device };
}

export async function resolveCanonicalDeviceForRead(input: {
  actor?: AuthUser | null;
  deviceId: string;
  estateId: string | null;
  homeId: string | null;
  includeSnapshot?: boolean;
  surface?: string | null;
  source?: string | null;
}): Promise<CanonicalDeviceReadResolution> {
  const rawId = String(input.deviceId || "").trim();
  const activeEstateId = String(input.estateId || "").trim() || null;
  const activeHomeId = String(input.homeId || "").trim() || null;
  if (!rawId) {
    return { status: "not_found", device: null, snapshot: null, databaseRoundTrips: 0, resolutionSource: "none", reason: "missing_device_id" };
  }
  try {
    if (!input.includeSnapshot && isUuid(rawId)) {
      const cached = deviceReadScopeCache.get(rawId, activeEstateId);
      if (cached) {
        const validated = await validateResolvedDevice({
          actor: input.actor,
          device: cached,
          activeHomeId,
          activeEstateId,
          surface: input.surface,
          source: input.source,
        });
        if (validated.status === "hydrated") {
          return { status: "hydrated", device: validated.device, snapshot: null, databaseRoundTrips: 0, resolutionSource: "scope_cache" };
        }
        return { status: validated.status, device: null, snapshot: null, databaseRoundTrips: 0, resolutionSource: "scope_cache", reason: validated.reason };
      }
    }

    const selection = input.includeSnapshot ? `${CANONICAL_DEVICE_SELECT},${CANONICAL_DEVICE_SNAPSHOT_SELECT}` : CANONICAL_DEVICE_SELECT;
    let query = supabaseAdmin.from("devices").select(selection);
    query = isUuid(rawId) ? query.eq("id", rawId) : query.eq("external_id", rawId);
    const { data, error } = await query.maybeSingle();
    if (error) {
      logger.warn("canonical_device_read_query_failed", {
        device_ref: rawId,
        error_code: (error as any)?.code || null,
        source: input.source || null,
        surface: input.surface || null,
      });
      return { status: "query_failed", device: null, snapshot: null, databaseRoundTrips: 1, resolutionSource: "database", reason: "device_lookup_failed", error_code: (error as any)?.code || null };
    }
    if (!data) {
      return { status: "not_found", device: null, snapshot: null, databaseRoundTrips: 1, resolutionSource: "database", reason: "device_not_found" };
    }
    const { device_states: stateRelation, ...deviceRow } = data as Record<string, any>;
    const validated = await validateResolvedDevice({
      actor: input.actor,
      device: deviceRow,
      activeHomeId,
      activeEstateId,
      surface: input.surface,
      source: input.source,
    });
    if (validated.status !== "hydrated") {
      return { status: validated.status, device: null, snapshot: null, databaseRoundTrips: 1, resolutionSource: "database", reason: validated.reason };
    }
    return {
      status: "hydrated",
      device: validated.device,
      snapshot: relatedSnapshot(stateRelation),
      databaseRoundTrips: 1,
      resolutionSource: "database",
    };
  } catch (error: any) {
    logger.warn("canonical_device_read_resolution_failed", {
      device_ref: rawId,
      error_code: error?.code || null,
      source: input.source || null,
      surface: input.surface || null,
    });
    return { status: "query_failed", device: null, snapshot: null, databaseRoundTrips: 1, resolutionSource: "database", reason: "device_resolution_failed", error_code: error?.code || null };
  }
}

export async function resolveCanonicalDeviceForReadParityForTest(input: Parameters<typeof resolveCanonicalDeviceForRead>[0]) {
  return resolveCanonicalDeviceForRead(input);
}
