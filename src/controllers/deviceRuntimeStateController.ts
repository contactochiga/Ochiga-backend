import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { deviceRuntimeStateService } from "../services/deviceRuntimeStateService";
import { buildCanonicalDevicePresentation } from "../device/runtime/deviceStateEnrichment";
import { logger } from "../observability/logger";
import { sendPublicApiError } from "../services/publicApi";
import { exposeServerTiming, requestStageTimingSnapshot, timeRequestStage, timeRequestStageSync } from "../observability/requestStageTiming";
import { deviceReadScopeCache } from "../services/deviceReadScopeCache";
import { isTechnicalDeviceHiddenFromResidents } from "../services/deviceInventoryVisibility";

const ESTATE_WIDE_ROLES = new Set(["admin", "manager", "estate_admin", "facility_admin", "facility_manager", "operator"]);
const DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT = 50_000;

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function attachRoomNames(devices: Array<Record<string, any>>) {
  const roomIds = Array.from(new Set(devices.map((device) => String(device?.room_id || "").trim()).filter(isUuid)));
  if (!roomIds.length) return devices;
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select("id,name,home_id")
    .in("id", roomIds);
  if (error) {
    logger.warn("device_runtime_room_lookup_failed", { error });
    return devices;
  }
  const rooms = new Map((data || []).map((room: any) => [String(room.id), room]));
  return devices.map((device) => {
    const room = rooms.get(String(device?.room_id || ""));
    if (!room || (device.home_id && room.home_id && String(device.home_id) !== String(room.home_id))) return device;
    return { ...device, room_name: room.name || null };
  });
}

function compactIrSupportedKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry: any) => ({
      canonical_key: entry?.canonical_key || entry?.canonicalKey || entry?.key || null,
      key: entry?.key || entry?.provider_key || entry?.providerKey || entry?.key_code || entry?.code || null,
      key_code: entry?.key_code || entry?.code || entry?.provider_key || entry?.providerKey || null,
      key_name: entry?.key_name || entry?.label || entry?.canonical_key || entry?.canonicalKey || null,
      provider_key: entry?.provider_key || entry?.providerKey || entry?.code || null,
      key_id: entry?.key_id ?? entry?.keyId ?? null,
      id: entry?.id ?? entry?.key_id ?? entry?.keyId ?? null,
      label: entry?.label || null,
      supported: entry?.supported !== false,
      dispatch_mode: entry?.dispatch_mode || entry?.dispatchMode || null,
    }))
    .filter((entry) => entry.canonical_key || entry.provider_key || entry.key_id != null);
}

function compactDeviceMetadata(metadata: Record<string, any> | null | undefined) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const ir = source.ir_appliance && typeof source.ir_appliance === "object" ? source.ir_appliance : null;
  const oyi = source.oyi && typeof source.oyi === "object" ? source.oyi : {};
  const compact: Record<string, any> = {
    device_family: source.device_family || source.family || null,
    control_profile: source.control_profile || null,
    ownership_class: source.ownership_class || oyi.ownership_class || null,
    projection_policy: source.projection_policy || source.visibility_policy || oyi.projection_policy || null,
  };
  if (ir) {
    compact.ir_appliance = {
      infrared_id: ir.infrared_id || ir.infraredId || null,
      remote_id: ir.remote_id || ir.remoteId || null,
      remote_index: ir.remote_index ?? ir.remoteIndex ?? null,
      category_id: ir.category_id || ir.categoryId || null,
      brand_id: ir.brand_id || ir.brandId || null,
      appliance_type: ir.appliance_type || ir.applianceType || null,
      supported_keys: compactIrSupportedKeys(ir.supported_keys || ir.supportedKeys || ir.key_map || ir.keyMap),
    };
  }
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value != null));
}

function compactRuntimeState(state: Record<string, any> | null | undefined, normalized: Record<string, any> | null | undefined) {
  const source = state && typeof state === "object" ? state : {};
  const normalizedSource = normalized && typeof normalized === "object" ? normalized : {};
  const allowedKeys = [
    "online",
    "power",
    "switch",
    "switch_1",
    "switch_2",
    "switch_3",
    "mode",
    "temperature",
    "temp_set",
    "fan_speed",
    "locked",
    "lock_state",
    "door_state",
    "battery",
    "battery_percentage",
    "batteryPercentage",
    "residual_electricity",
  ];
  const compact: Record<string, any> = {};
  for (const key of allowedKeys) {
    if (source[key] == null) continue;
    compact[key] = source[key];
  }
  if (Object.keys(normalizedSource).length) compact.normalized_state = normalizedSource;
  return compact;
}

function runtimeContractFreshness(runtime: any) {
  const authorizationState = String(runtime?.authorization_state || "");
  if (authorizationState === "device_not_linked" || authorizationState === "authorization_required") return "provider_disconnected";
  if (runtime?.provider_warning || runtime?.provider_error) return "unavailable";
  if (runtime?.freshness === "fresh") return "fresh";
  if (runtime?.freshness === "stale") return "ageing";
  return "expired";
}

export async function getDeviceRuntimeDashboard(req: Request, res: Response) {
  const user: any = req.user;
  const context: any = (req as any).oisContext || null;
  const estateId = String(context?.estate_id || user?.estate_id || "").trim();
  const activeHomeId = String(context?.home_id || user?.home_id || "").trim();
  try {
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
    if (!estateId) return res.status(400).json({ error: "Active estate context is required" });

    const estateWide = ESTATE_WIDE_ROLES.has(String(user.role || "").toLowerCase());
    if (!estateWide && !activeHomeId) {
      return res.status(400).json({ error: "Active home context is required" });
    }

    let query = supabaseAdmin
      .from("devices")
      .select("id,name,estate_id,home_id,room_id,parent_device_id,is_virtual,external_id,vendor,provider,adapter,online,status,type,category,capabilities,metadata,last_seen_at,updated_at")
      .eq("estate_id", estateId)
      .order("updated_at", { ascending: false })
      .limit(2_000);

    const requestedHomeId = String(req.query.home_id || "").trim();
    if (!estateWide) query = query.eq("home_id", activeHomeId);
    else if (requestedHomeId) query = query.eq("home_id", requestedHomeId);

    const { data, error } = await timeRequestStage(req, "runtime_registry", async () => await query);
    if (error) throw error;
    const allDevices = await attachRoomNames(data || []);
    const irParentIds = new Set(
      allDevices
        .filter((device: any) => device?.is_virtual && device?.metadata?.ir_appliance?.remote_id)
        .map((device: any) => String(device?.parent_device_id || "").trim())
        .filter(Boolean),
    );
    const devices = estateWide ? allDevices : allDevices.filter((device: any) =>
      !isTechnicalDeviceHiddenFromResidents(device, { parentHasIrChildren: irParentIds.has(String(device?.id || "")) }),
    );
    deviceReadScopeCache.setMany(devices);
    const cacheMisses = devices.filter((device: any) => !deviceRuntimeStateService.has(String(device.id))).length;
    await timeRequestStage(req, "runtime_snapshot_batch", () => deviceRuntimeStateService.hydrateMany(devices));

    let expiredCount = 0;
    let staleCount = 0;
    const freshnessCounts: Record<string, number> = {
      fresh: 0,
      ageing: 0,
      expired: 0,
      unavailable: 0,
      provider_disconnected: 0,
    };
    const runtimeDevices = timeRequestStageSync(req, "runtime_frontend_contracts", () => devices.map((device: any) => {
      const runtime = deviceRuntimeStateService.get(String(device.id));
      if (!runtime || runtime.freshness === "expired" || runtime.dirty) expiredCount += 1;
      else if (runtime.stale) staleCount += 1;
      const freshnessState = runtimeContractFreshness(runtime);
      freshnessCounts[freshnessState] = (freshnessCounts[freshnessState] || 0) + 1;
      const summary = runtime?.summary || null;
      const canonicalState = summary?.canonical_state
        ? {
          ...summary.canonical_state,
          availability: runtime?.stale && summary.canonical_state.availability === "online" ? "stale" : summary.canonical_state.availability,
          lastSeenAt: summary.canonical_state.lastSeenAt || runtime?.last_refresh || device.last_seen_at || null,
          lastProviderSyncAt: summary.canonical_state.lastProviderSyncAt || runtime?.provider_timestamp || null,
          staleAfterMs: runtime?.ttl || summary.canonical_state.staleAfterMs || 10_000,
        }
        : null;
      const presentation = canonicalState
        ? buildCanonicalDevicePresentation(device, canonicalState, { ...(summary || {}), normalized_state: summary?.normalized_state || {} })
        : summary?.canonical_presentation || null;
      return {
        id: String(device.id),
        device_id: String(device.id),
        name: String(device.name || "Device"),
        estate_id: device.estate_id || null,
        home_id: device.home_id || null,
        room_id: device.room_id || null,
        room_name: device.room_name || null,
        parent_device_id: device.parent_device_id || null,
        is_virtual: Boolean(device.is_virtual),
        external_id: device.external_id || null,
        provider: device.provider || device.vendor || null,
        vendor: device.vendor || device.provider || null,
        adapter: device.adapter || device.vendor || device.provider || null,
        type: device.type || null,
        category: device.category || null,
        metadata: compactDeviceMetadata(device.metadata || {}),
        state: compactRuntimeState(runtime?.state || {}, summary?.normalized_state || {}),
        canonical_state: canonicalState,
        canonicalState,
        canonical_presentation: presentation,
        presentation,
        normalized_state: summary?.normalized_state || {},
        primary_state: summary?.primary_state || "unknown",
        health_status: summary?.health_status || "unknown",
        provider_health: summary?.provider_health || "unknown",
        provider_warning: runtime?.provider_warning || null,
        authorization_state: runtime?.authorization_state || "unknown",
        last_provider_error: runtime?.provider_error || null,
        retry_after: runtime?.retry_after || null,
        last_successful_refresh: runtime?.last_successful_refresh || null,
        freshness_state: freshnessState,
        runtime_freshness: freshnessState,
        last_confirmed_at: runtime?.last_successful_refresh || runtime?.provider_timestamp || runtime?.last_refresh || device.last_seen_at || null,
        is_cache_expired: freshnessState === "expired",
        supported_controls: summary?.supported_controls || [],
        capabilities: summary?.capabilities || device.capabilities || [],
        channel_definitions: summary?.channel_definitions || [],
        control_profile: summary?.control_profile || device.metadata?.control_profile || "generic",
        device_family: summary?.device_family || device.metadata?.device_family || "unknown",
        telemetry_summary: null,
        activity_summary: summary?.activity_summary || null,
        capability_codes: summary?.capability_codes || [],
        provider_timestamp: runtime?.provider_timestamp || null,
        runtime_timestamp: runtime?.runtime_timestamp || null,
        last_refresh: runtime?.last_refresh || null,
        ttl: runtime?.ttl || 10_000,
        stale: runtime?.stale ?? true,
        freshness: runtime?.freshness || "expired",
        synchronizing: !runtime,
      };
    }));

    const body = {
      devices: runtimeDevices,
      count: runtimeDevices.length,
      generated_at: new Date().toISOString(),
      source: "oyi_device_runtime_v2",
      provider_requests: 0,
      provider_requests_sync: 0,
      provider_requests_deferred: 0,
      provider_refreshes_scheduled: 0,
      dashboard_mode: "compact_cache_only",
      runtime: deviceRuntimeStateService.stats(),
      freshness_counts: freshnessCounts,
      payload_budget_bytes: DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT,
    };
    const serialized = timeRequestStageSync(req, "serialization", () => JSON.stringify(body));
    const responseBytes = Buffer.byteLength(serialized);
    exposeServerTiming(req, res);
    const timing = requestStageTimingSnapshot(req);
    if (responseBytes > DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT) {
      logger.warn("device_runtime_dashboard_payload_budget_exceeded", {
        estate_id: estateId,
        home_id: requestedHomeId || activeHomeId || null,
        device_count: devices.length,
        response_bytes: responseBytes,
        budget_bytes: DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT,
      });
    }
    logger.info("device_runtime_dashboard_timing", {
      estate_id: estateId,
      home_id: requestedHomeId || activeHomeId || null,
      device_count: devices.length,
      memory_hits: devices.length - cacheMisses,
      snapshot_cache_misses: cacheMisses,
      database_round_trips: 1 + (cacheMisses ? 1 : 0),
      provider_requests: 0,
      provider_requests_sync: 0,
      provider_requests_deferred: 0,
      provider_refreshes_scheduled: 0,
      stale_count: staleCount,
      expired_count: expiredCount,
      freshness_counts: freshnessCounts,
      cache_only: true,
      response_bytes: responseBytes,
      payload_budget_bytes: DEVICE_RUNTIME_PAYLOAD_BYTE_LIMIT,
      total_ms: timing.total_ms,
      stages: timing.stages,
    });
    res.type("application/json");
    return res.send(serialized);
  } catch (error) {
    logger.error("device_runtime_dashboard_failed", {
      error,
      estate_id: estateId || null,
      home_id: activeHomeId || null,
      actor_id: user?.id || null,
    });
    return sendPublicApiError(
      res,
      error,
      { statusCode: 503, code: "device_runtime_unavailable", message: "Device runtime is temporarily unavailable." },
      { operation: "devices.runtime.dashboard", estate_id: estateId, home_id: activeHomeId },
    );
  }
}
