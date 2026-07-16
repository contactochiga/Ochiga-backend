import { Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { loadDeviceIntelligenceContext } from "../services/deviceIntelligenceService";
import { buildDeviceTimeline } from "../services/deviceRuntimeService";
import { deviceRuntimeStateService, type DeviceRuntimeSnapshot } from "../services/deviceRuntimeStateService";
import { logger } from "../observability/logger";
import { sendPublicApiError } from "../services/publicApi";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stateResponse(device: any, runtime: DeviceRuntimeSnapshot | null, intelligence: any) {
  const summary = runtime?.summary || null;
  const state = runtime?.state || {};
  const stateRow = runtime
    ? { status: state, last_seen: runtime.last_refresh, updated_at: runtime.runtime_timestamp }
    : null;
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
    primary_state: summary?.primary_state || "unknown",
    telemetry_summary: summary?.telemetry_summary || {},
    device_family: summary?.device_family || device.metadata?.device_family || "unknown",
    device_type: summary?.device_type || device.type || device.category || "device",
    last_signal: summary?.last_signal || null,
    activity_summary: summary?.activity_summary || null,
    channel_definitions: summary?.channel_definitions || [],
    capability_codes: summary?.capability_codes || [],
    lastSeen: runtime?.last_refresh || device.last_seen_at || null,
    provider_timestamp: runtime?.provider_timestamp || null,
    runtime_timestamp: runtime?.runtime_timestamp || null,
    last_refresh: runtime?.last_refresh || null,
    ttl: runtime?.ttl || 10_000,
    stale: runtime?.stale ?? true,
    freshness: runtime?.freshness || "expired",
    provider_latency_ms: runtime?.provider_latency_ms || null,
    dirty: runtime?.dirty ?? true,
    timeline: buildDeviceTimeline(device, stateRow),
    memory_summary: intelligence?.memory_summary || null,
    relationships: intelligence?.relationships || null,
    predictive_findings: intelligence?.predictive_findings || [],
    recent_executions: intelligence?.recent_executions || [],
    active_scenes: intelligence?.active_scenes || [],
    active_automations: intelligence?.active_automations || [],
    conversation_context: intelligence?.conversation_context || null,
    source: runtime?.source || "runtime_pending",
    synchronizing: !runtime,
  };
}

export async function getDeviceState(req: any, res: Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");

  const rawId = String(req.params.deviceId || "").trim();
  const estateId = req.oisContext?.estate_id || req.user?.estate_id || null;
  const homeId = req.oisContext?.home_id || req.user?.home_id || null;
  try {
    if (!estateId) return res.status(400).json({ error: "User has no estate" });
    if (!rawId) return res.status(400).json({ error: "Missing deviceId" });

    let query = supabaseAdmin
      .from("devices")
      .select("id,name,estate_id,home_id,room_id,parent_device_id,is_virtual,external_id,vendor,provider,adapter,online,status,type,category,capabilities,metadata,last_seen_at,last_event_at,updated_at")
      .eq("estate_id", estateId);
    query = isUuid(rawId) ? query.eq("id", rawId) : query.eq("external_id", rawId);
    const { data: device, error } = await query.maybeSingle();
    if (error) throw error;
    if (!device?.id) return res.status(404).json({ error: "Device not found" });
    if (homeId && String(device.home_id || "") !== String(homeId)) {
      return res.status(403).json({ error: "This device is not assigned to your current home." });
    }

    const runtime = await deviceRuntimeStateService.getOrHydrate(device);
    if (deviceRuntimeStateService.shouldRefresh(runtime)) {
      deviceRuntimeStateService.scheduleRefresh(device, {
        priority: !runtime || runtime.freshness === "expired" ? "high" : "normal",
        reason: "device_opened",
      });
    }

    const intelligence = runtime
      ? await loadDeviceIntelligenceContext({
          device,
          stateRow: { status: runtime.state, last_seen: runtime.last_refresh, updated_at: runtime.runtime_timestamp },
        }).catch(() => null)
      : null;

    return res.json(stateResponse(device, runtime, intelligence));
  } catch (error) {
    logger.error("device_runtime_state_request_failed", {
      error,
      device_ref: rawId || null,
      estate_id: estateId,
      home_id: homeId,
    });
    return sendPublicApiError(
      res,
      error,
      { statusCode: 503, code: "device_runtime_unavailable", message: "Device state is temporarily unavailable." },
      { operation: "devices.state.runtime", device_ref: rawId, estate_id: estateId, home_id: homeId },
    );
  }
}
