import { buildDeviceStateResponse } from "../controllers/deviceStateController";
import { buildDeviceTimeline } from "./deviceRuntimeService";
import { loadDeviceIntelligenceContext } from "./deviceIntelligenceService";
import { deviceRuntimeStateService } from "./deviceRuntimeStateService";
import { deviceReadScopeCache } from "./deviceReadScopeCache";
import {
  isTechnicalDeviceHiddenFromResidents,
  resolveCanonicalIrChildForProviderRemote,
} from "./deviceInventoryVisibility";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { logger } from "../observability/logger";

const DEVICE_SELECT = "id,name,estate_id,home_id,room_id,parent_device_id,is_virtual,external_id,vendor,provider,adapter,online,status,type,category,capabilities,metadata,last_seen_at,last_event_at,updated_at";
const SNAPSHOT_SELECT = "device_states(device_id,status,last_seen,updated_at)";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function relatedSnapshot(value: unknown) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

async function withRoomName(device: Record<string, any>) {
  const roomId = String(device?.room_id || "").trim();
  if (!roomId || !isUuid(roomId)) return device;
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select("id,name,home_id")
    .eq("id", roomId)
    .maybeSingle();
  if (error || !data) {
    if (error) logger.warn("canonical_device_hydration_room_lookup_failed", { error_code: (error as any)?.code || null, device_id: device?.id, room_id: roomId });
    return device;
  }
  if (device.home_id && data.home_id && String(device.home_id) !== String(data.home_id)) return device;
  return { ...device, room_name: data.name || null };
}

export type CanonicalDevicePanelHydrationResult =
  | { status: "hydrated"; device: Record<string, any>; runtime: ReturnType<typeof deviceRuntimeStateService.get>; panel: Record<string, any>; source: "runtime_cache" | "persistent_snapshot" | "canonical_backend" }
  | { status: "not_found" | "scope_mismatch" | "query_failed" | "unavailable"; reason: string; error_code?: string | null };

export async function hydrateCanonicalDevicePanel(input: {
  deviceId: string;
  estateId: string | null;
  homeId: string | null;
  includeIntelligence?: boolean;
  includeTimeline?: boolean;
}): Promise<CanonicalDevicePanelHydrationResult> {
  const rawId = String(input.deviceId || "").trim();
  const estateId = String(input.estateId || "").trim();
  const homeId = String(input.homeId || "").trim();
  if (!rawId || !estateId) return { status: "unavailable", reason: "missing_scope" };
  try {
    const warmCandidate = isUuid(rawId) && deviceRuntimeStateService.has(rawId);
    const selection = warmCandidate ? DEVICE_SELECT : `${DEVICE_SELECT},${SNAPSHOT_SELECT}`;
    let query = supabaseAdmin.from("devices").select(selection).eq("estate_id", estateId);
    query = isUuid(rawId) ? query.eq("id", rawId) : query.eq("external_id", rawId);
    const { data, error } = await query.maybeSingle();
    if (error) {
      logger.warn("canonical_device_hydration_query_failed", {
        table: "devices",
        object_type: "device",
        device_id: rawId,
        error_code: (error as any)?.code || null,
        error_message: (error as any)?.message || "query_failed",
      });
      return { status: "query_failed", reason: "device_lookup_failed", error_code: (error as any)?.code || null };
    }
    if (!data) return { status: "not_found", reason: "device_not_found" };
    const { device_states: stateRelation, ...deviceRow } = data as Record<string, any>;
    let device = deviceRow;
    deviceReadScopeCache.set(device);
    const canonicalChild = await resolveCanonicalIrChildForProviderRemote(device);
    if (canonicalChild?.id) device = canonicalChild;
    if (isTechnicalDeviceHiddenFromResidents(device)) return { status: "not_found", reason: "device_hidden_from_resident_inventory" };
    if (homeId && String(device.home_id || "") !== homeId) return { status: "scope_mismatch", reason: "device_outside_active_home" };
    device = await withRoomName(device);

    let runtime = deviceRuntimeStateService.get(String(device.id));
    let source: "runtime_cache" | "persistent_snapshot" | "canonical_backend" = runtime ? "runtime_cache" : "canonical_backend";
    if (!runtime && !warmCandidate) {
      runtime = deviceRuntimeStateService.hydrateSnapshot(device, relatedSnapshot(stateRelation));
      if (runtime) source = "persistent_snapshot";
    }
    if (!runtime) {
      await deviceRuntimeStateService.hydrateMany([device]);
      runtime = deviceRuntimeStateService.get(String(device.id));
      if (runtime) source = runtime.source === "persistent_snapshot" ? "persistent_snapshot" : "runtime_cache";
    }

    let intelligence: any = undefined;
    if (input.includeIntelligence && runtime) {
      const stateRow = { status: runtime.state, last_seen: runtime.last_refresh, updated_at: runtime.runtime_timestamp };
      intelligence = await loadDeviceIntelligenceContext({ device, stateRow }).catch((error) => {
        logger.warn("canonical_device_hydration_intelligence_failed", { device_id: device.id, error_code: (error as any)?.code || null });
        return null;
      });
    }
    const timeline = input.includeTimeline
      ? buildDeviceTimeline(device, runtime ? { status: runtime.state, last_seen: runtime.last_refresh, updated_at: runtime.runtime_timestamp } : null)
      : undefined;
    const panel = buildDeviceStateResponse({ device, runtime, intelligence, timeline });
    return { status: "hydrated", device, runtime, panel, source };
  } catch (error: any) {
    logger.warn("canonical_device_hydration_failed", {
      table: "devices",
      object_type: "device",
      device_id: rawId,
      error_code: error?.code || null,
      error_message: error?.message || "hydration_failed",
    });
    return { status: "query_failed", reason: "device_hydration_failed", error_code: error?.code || null };
  }
}
