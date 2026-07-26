import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { loadDeviceIntelligenceContext } from "../services/deviceIntelligenceService";
import { buildDeviceTimeline } from "../services/deviceRuntimeService";
import { deviceRuntimeStateService, type DeviceRuntimeSnapshot } from "../services/deviceRuntimeStateService";
import { logger } from "../observability/logger";
import { exposeServerTiming, requestStageTimingSnapshot, timeRequestStage, timeRequestStageSync } from "../observability/requestStageTiming";
import { sendPublicApiError } from "../services/publicApi";
import { deviceReadScopeCache } from "../services/deviceReadScopeCache";
import { buildCanonicalDevicePresentation } from "../device/runtime/deviceStateEnrichment";
import {
  isTechnicalDeviceHiddenFromResidents,
  resolveCanonicalIrChildForProviderRemote,
} from "../services/deviceInventoryVisibility";

const DEVICE_SELECT = "id,name,estate_id,home_id,room_id,parent_device_id,is_virtual,external_id,vendor,provider,adapter,online,status,type,category,capabilities,metadata,last_seen_at,last_event_at,updated_at";
const SNAPSHOT_SELECT = "device_states(device_id,status,last_seen,updated_at)";

type StateIncludes = {
  intelligence: boolean;
  timeline: boolean;
};

type DeviceStateControllerDependencies = {
  runtime: Pick<typeof deviceRuntimeStateService, "has" | "get" | "hydrateSnapshot" | "markViewed" | "releaseViewed" | "shouldRefresh" | "scheduleRefresh">;
  findDevice: (input: { rawId: string; estateId: string; includeSnapshot: boolean }) => Promise<{
    device: Record<string, any> | null;
    snapshot: Record<string, any> | null;
    databaseRoundTrips?: number;
    resolutionSource?: "scope_cache" | "database";
  }>;
  loadIntelligence: typeof loadDeviceIntelligenceContext;
  buildTimeline: typeof buildDeviceTimeline;
  defer: (operation: () => void) => void;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseDeviceStateIncludes(value: unknown): StateIncludes {
  const values = new Set(String(value || "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  const all = values.has("all");
  return {
    intelligence: all || values.has("intelligence"),
    timeline: all || values.has("timeline"),
  };
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
    if (error) logger.warn("device_state_room_lookup_failed", { error, device_id: device?.id, room_id: roomId });
    return device;
  }
  if (device.home_id && data.home_id && String(device.home_id) !== String(data.home_id)) return device;
  return { ...device, room_name: data.name || null };
}

async function findDevice(input: { rawId: string; estateId: string; includeSnapshot: boolean }) {
  if (!input.includeSnapshot && isUuid(input.rawId)) {
    const cached = deviceReadScopeCache.get(input.rawId, input.estateId);
    if (cached) return { device: cached, snapshot: null, databaseRoundTrips: 0, resolutionSource: "scope_cache" as const };
  }
  const selection = input.includeSnapshot ? `${DEVICE_SELECT},${SNAPSHOT_SELECT}` : DEVICE_SELECT;
  let query = supabaseAdmin.from("devices").select(selection).eq("estate_id", input.estateId);
  query = isUuid(input.rawId) ? query.eq("id", input.rawId) : query.eq("external_id", input.rawId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return { device: null, snapshot: null, databaseRoundTrips: 1, resolutionSource: "database" as const };
  const { device_states: stateRelation, ...device } = data as Record<string, any>;
  deviceReadScopeCache.set(device);
  return { device, snapshot: relatedSnapshot(stateRelation), databaseRoundTrips: 1, resolutionSource: "database" as const };
}

export function buildDeviceStateResponse(input: {
  device: Record<string, any>;
  runtime: DeviceRuntimeSnapshot | null;
  intelligence?: any;
  timeline?: any;
}) {
  const { device, runtime, intelligence, timeline } = input;
  const summary = runtime?.summary || null;
  const state = runtime?.state || {};
  const canonicalState = summary?.canonical_state || null;
  const presentation = canonicalState
    ? buildCanonicalDevicePresentation(device, canonicalState, { ...(summary || {}), normalized_state: summary?.normalized_state || {} })
    : summary?.canonical_presentation || null;
  return {
    deviceId: device.id,
    device_id: device.id,
    external_id: device.external_id || null,
    vendor: device.vendor ?? device.provider ?? device.adapter ?? null,
    adapter: device.adapter ?? device.vendor ?? null,
    state,
    normalized_state: summary?.normalized_state || {},
    capabilities: summary?.capabilities || device.capabilities || [],
    supported_controls: summary?.supported_controls || [],
    control_profile: summary?.control_profile || "generic",
    health_status: summary?.health_status || "unknown",
    provider_health: summary?.provider_health || "unknown",
    provider_warning: runtime?.provider_warning || null,
    authorization_state: runtime?.authorization_state || "unknown",
    last_provider_error: runtime?.provider_error || null,
    retry_after: runtime?.retry_after || null,
    last_successful_refresh: runtime?.last_successful_refresh || null,
    primary_state: summary?.primary_state || "unknown",
    telemetry_summary: summary?.telemetry_summary || {},
    device_family: summary?.device_family || device.metadata?.device_family || "unknown",
    device_type: summary?.device_type || device.type || device.category || "device",
    last_signal: summary?.last_signal || null,
    activity_summary: summary?.activity_summary || null,
    channel_definitions: summary?.channel_definitions || [],
    capability_codes: summary?.capability_codes || [],
    canonical_state: canonicalState,
    canonicalState,
    canonical_presentation: presentation,
    presentation,
    assignment: presentation?.assignment || {
      estateId: device.estate_id || null,
      buildingId: device.building_id || device.metadata?.building_id || null,
      homeId: device.home_id || null,
      roomId: device.room_id || null,
      roomName: device.room_name || null,
    },
    room_id: device.room_id || null,
    room_name: device.room_name || null,
    lastSeen: runtime?.last_refresh || device.last_seen_at || null,
    provider_timestamp: runtime?.provider_timestamp || null,
    runtime_timestamp: runtime?.runtime_timestamp || null,
    last_refresh: runtime?.last_refresh || null,
    ttl: runtime?.ttl || 10_000,
    stale: runtime?.stale ?? true,
    freshness: runtime?.freshness || "expired",
    provider_latency_ms: runtime?.provider_latency_ms || null,
    dirty: runtime?.dirty ?? true,
    ...(timeline !== undefined ? { timeline } : {}),
    ...(intelligence !== undefined ? {
      memory_summary: intelligence?.memory_summary || null,
      relationships: intelligence?.relationships || null,
      predictive_findings: intelligence?.predictive_findings || [],
      recent_executions: intelligence?.recent_executions || [],
      active_scenes: intelligence?.active_scenes || [],
      active_automations: intelligence?.active_automations || [],
      conversation_context: intelligence?.conversation_context || null,
    } : {}),
    source: runtime?.source || "runtime_pending",
    synchronizing: !runtime,
  };
}

const defaultDependencies: DeviceStateControllerDependencies = {
  runtime: deviceRuntimeStateService,
  findDevice,
  loadIntelligence: loadDeviceIntelligenceContext,
  buildTimeline: buildDeviceTimeline,
  defer: (operation) => setImmediate(operation),
};

export function createGetDeviceState(overrides: Partial<DeviceStateControllerDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function getDeviceStateHandler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    res.removeHeader("ETag");
    res.removeHeader("Last-Modified");

    const rawId = String(req.params.deviceId || "").trim();
    const estateId = req.oisContext?.estate_id || req.user?.estate_id || null;
    const homeId = req.oisContext?.home_id || req.user?.home_id || null;
    const includes = parseDeviceStateIncludes(req.query.include);
    const viewMode = String(req.query.view || req.query.lease || "").trim().toLowerCase();
    const wantsViewLease = ["panel", "device", "active"].includes(viewMode);
    let stateDbRoundTrips = 0;
    let snapshotIncluded = false;
    let cacheSource = "miss";
    let resolutionSource = "database";

    try {
      if (!estateId) return res.status(400).json({ error: "User has no estate" });
      if (!rawId) return res.status(400).json({ error: "Missing deviceId" });

      const warmCandidate = isUuid(rawId) && dependencies.runtime.has(rawId);
      snapshotIncluded = !warmCandidate;
      const resolved = await timeRequestStage(req, "device_resolution", async () => {
        return dependencies.findDevice({ rawId, estateId, includeSnapshot: snapshotIncluded });
      });
      stateDbRoundTrips += resolved.databaseRoundTrips ?? 1;
      resolutionSource = resolved.resolutionSource || "database";
      const resolvedDevice = resolved.device;
      if (!resolvedDevice?.id) return res.status(404).json({ error: "Device not found" });
      let device: Record<string, any> = resolvedDevice;
      const canonicalChild = await resolveCanonicalIrChildForProviderRemote(device);
      if (canonicalChild?.id) device = canonicalChild;
      if (isTechnicalDeviceHiddenFromResidents(device)) {
        return res.status(404).json({ error: "Device not found in this home" });
      }
      if (homeId && String(device.home_id || "") !== String(homeId)) {
        return res.status(403).json({ error: "This device is not assigned to your current home." });
      }
      device = await timeRequestStage(req, "room_assignment", async () => withRoomName(device));

      let runtime = timeRequestStageSync(req, "runtime_memory", () => dependencies.runtime.get(String(device.id)));
      if (runtime) {
        cacheSource = "memory";
      } else if (resolved.snapshot) {
        runtime = timeRequestStageSync(req, "snapshot_hydration", () => dependencies.runtime.hydrateSnapshot(device, resolved.snapshot));
        cacheSource = runtime ? "persistent_snapshot" : "miss";
      }
      if (wantsViewLease) {
        runtime = timeRequestStageSync(req, "runtime_view_lease", () => dependencies.runtime.markViewed(String(device.id), {
          ttlMs: 45_000,
          source: "device_panel",
          estateId,
          homeId,
          actorId: req.user?.id || null,
        })) || runtime;
      }

      let intelligence: any = undefined;
      if (includes.intelligence && runtime) {
        const stateRow = { status: runtime.state, last_seen: runtime.last_refresh, updated_at: runtime.runtime_timestamp };
        intelligence = await timeRequestStage(req, "intelligence", () => dependencies.loadIntelligence({ device, stateRow }).catch(() => null));
        stateDbRoundTrips += device.parent_device_id ? 6 : 5;
      }

      const timeline = includes.timeline
        ? timeRequestStageSync(req, "timeline", () => dependencies.buildTimeline(device, runtime
          ? { status: runtime.state, last_seen: runtime.last_refresh, updated_at: runtime.runtime_timestamp }
          : null))
        : undefined;

      const body = timeRequestStageSync(req, "frontend_contract", () => buildDeviceStateResponse({ device, runtime, intelligence, timeline }));
      const serialized = timeRequestStageSync(req, "serialization", () => JSON.stringify(body));

      const refreshDeferred = wantsViewLease && dependencies.runtime.shouldRefresh(runtime);
      if (refreshDeferred) {
        dependencies.defer(() => dependencies.runtime.scheduleRefresh(device, {
          priority: !runtime || runtime.freshness === "expired" ? "high" : "normal",
          reason: "device_panel_view_stale",
          markDirty: false,
        }));
      }

      exposeServerTiming(req, res);
      const timing = requestStageTimingSnapshot(req);
      logger.info("device_runtime_state_read_timing", {
        device_id: String(device.id),
        estate_id: estateId,
        home_id: homeId,
        cache_source: cacheSource,
        resolution_source: resolutionSource,
        snapshot_joined: snapshotIncluded,
        include_intelligence: includes.intelligence,
        include_timeline: includes.timeline,
        state_path_db_round_trips: stateDbRoundTrips,
        response_bytes: Buffer.byteLength(serialized),
        view_lease_acquired: wantsViewLease,
        provider_requests_sync: 0,
        provider_requests_deferred: refreshDeferred ? 1 : 0,
        provider_refreshes_scheduled: refreshDeferred ? 1 : 0,
        refresh_deferred: refreshDeferred,
        total_ms: timing.total_ms,
        stages: timing.stages,
      });
      res.type("application/json");
      return res.send(serialized);
    } catch (error) {
      logger.error("device_runtime_state_request_failed", {
        error,
        device_ref: rawId || null,
        estate_id: estateId,
        home_id: homeId,
        stages: requestStageTimingSnapshot(req).stages,
      });
      return sendPublicApiError(
        res,
        error,
        { statusCode: 503, code: "device_runtime_unavailable", message: "Device state is temporarily unavailable." },
        { operation: "devices.state.runtime", device_ref: rawId, estate_id: estateId, home_id: homeId },
      );
    }
  };
}

export const getDeviceState = createGetDeviceState();

export function createReleaseDeviceStateView(overrides: Partial<DeviceStateControllerDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function releaseDeviceStateViewHandler(req: Request, res: Response) {
    const rawId = String(req.params.deviceId || "").trim();
    const estateId = req.oisContext?.estate_id || req.user?.estate_id || null;
    const homeId = req.oisContext?.home_id || req.user?.home_id || null;
    try {
      if (!estateId) return res.status(400).json({ error: "User has no estate" });
      if (!rawId) return res.status(400).json({ error: "Missing deviceId" });
      const resolved = await dependencies.findDevice({ rawId, estateId, includeSnapshot: false });
      let device = resolved.device;
      if (!device?.id) return res.status(404).json({ error: "Device not found" });
      const canonicalChild = await resolveCanonicalIrChildForProviderRemote(device);
      if (canonicalChild?.id) device = canonicalChild;
      if (!device?.id) return res.status(404).json({ error: "Device not found" });
      if (isTechnicalDeviceHiddenFromResidents(device)) return res.status(404).json({ error: "Device not found in this home" });
      if (homeId && String(device.home_id || "") !== String(homeId)) {
        return res.status(403).json({ error: "This device is not assigned to your current home." });
      }
      const snapshot = dependencies.runtime.releaseViewed(String(device.id), {
        source: "device_panel",
        estateId,
        homeId,
        actorId: req.user?.id || null,
      });
      return res.json({
        ok: true,
        device_id: String(device.id),
        viewed_until_at: snapshot?.viewed_until_at || null,
      });
    } catch (error) {
      logger.error("device_runtime_view_release_failed", {
        error,
        device_ref: rawId || null,
        estate_id: estateId,
        home_id: homeId,
      });
      return sendPublicApiError(
        res,
        error,
        { statusCode: 503, code: "device_runtime_view_release_failed", message: "Device view lease could not be released." },
        { operation: "devices.state.release", device_ref: rawId, estate_id: estateId, home_id: homeId },
      );
    }
  };
}

export const releaseDeviceStateView = createReleaseDeviceStateView();
