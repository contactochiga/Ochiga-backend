import type { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { deviceRuntimeStateService } from "../services/deviceRuntimeStateService";
import { logger } from "../observability/logger";
import { sendPublicApiError } from "../services/publicApi";
import { exposeServerTiming, requestStageTimingSnapshot, timeRequestStage, timeRequestStageSync } from "../observability/requestStageTiming";
import { deviceReadScopeCache } from "../services/deviceReadScopeCache";
import { isTechnicalDeviceHiddenFromResidents } from "../services/deviceInventoryVisibility";

const ESTATE_WIDE_ROLES = new Set(["admin", "manager", "estate_admin", "facility_admin", "facility_manager", "operator"]);

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
    const allDevices = data || [];
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

    const expired: any[] = [];
    const stale: any[] = [];
    const runtimeDevices = timeRequestStageSync(req, "runtime_frontend_contracts", () => devices.map((device: any) => {
      const runtime = deviceRuntimeStateService.get(String(device.id));
      if (!runtime || runtime.freshness === "expired" || runtime.dirty) expired.push(device);
      else if (runtime.stale) stale.push(device);
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
      return {
        id: String(device.id),
        device_id: String(device.id),
        name: String(device.name || "Device"),
        estate_id: device.estate_id || null,
        home_id: device.home_id || null,
        room_id: device.room_id || null,
        parent_device_id: device.parent_device_id || null,
        is_virtual: Boolean(device.is_virtual),
        external_id: device.external_id || null,
        provider: device.provider || device.vendor || null,
        vendor: device.vendor || device.provider || null,
        adapter: device.adapter || device.vendor || device.provider || null,
        type: device.type || null,
        category: device.category || null,
        metadata: device.metadata || {},
        state: runtime?.state || {},
        canonical_state: canonicalState,
        canonicalState,
        normalized_state: summary?.normalized_state || {},
        primary_state: summary?.primary_state || "unknown",
        health_status: summary?.health_status || "unknown",
        provider_health: summary?.provider_health || "unknown",
        provider_warning: runtime?.provider_warning || null,
        authorization_state: runtime?.authorization_state || "unknown",
        last_provider_error: runtime?.provider_error || null,
        retry_after: runtime?.retry_after || null,
        last_successful_refresh: runtime?.last_successful_refresh || null,
        supported_controls: summary?.supported_controls || [],
        capabilities: summary?.capabilities || device.capabilities || [],
        channel_definitions: summary?.channel_definitions || [],
        control_profile: summary?.control_profile || device.metadata?.control_profile || "generic",
        device_family: summary?.device_family || device.metadata?.device_family || "unknown",
        telemetry_summary: summary?.telemetry_summary || {},
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

    if (expired.length || stale.length) {
      setImmediate(() => {
        if (expired.length) void deviceRuntimeStateService.refreshMany(expired, "high", "runtime_dashboard_expired");
        if (stale.length) void deviceRuntimeStateService.refreshMany(stale, "normal", "runtime_dashboard_stale");
      });
    }

    const body = {
      devices: runtimeDevices,
      count: runtimeDevices.length,
      generated_at: new Date().toISOString(),
      source: "oyi_device_runtime_v2",
      provider_requests: 0,
      runtime: deviceRuntimeStateService.stats(),
    };
    const serialized = timeRequestStageSync(req, "serialization", () => JSON.stringify(body));
    exposeServerTiming(req, res);
    const timing = requestStageTimingSnapshot(req);
    logger.info("device_runtime_dashboard_timing", {
      estate_id: estateId,
      home_id: requestedHomeId || activeHomeId || null,
      device_count: devices.length,
      memory_hits: devices.length - cacheMisses,
      snapshot_cache_misses: cacheMisses,
      database_round_trips: 1 + (cacheMisses ? 1 : 0),
      provider_requests: 0,
      response_bytes: Buffer.byteLength(serialized),
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
