// src/controllers/deviceStateController.ts
import { Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { buildDeviceTimeline } from "../services/deviceRuntimeService";
import { enrichDeviceProviderState, summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

export async function getDeviceState(req: any, res: Response) {
  // ✅ HARD NO-CACHE (prevents 304 + stale/empty behaviour)
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  // ✅ prevent conditional requests from being honored
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");

  try {
    const estateId = req.oisContext?.estate_id || req.user?.estate_id;
    const homeId = req.oisContext?.home_id || req.user?.home_id || null;
    if (!estateId) return res.status(400).json({ error: "User has no estate" });

    const rawId = String(req.params.deviceId || "").trim();
    if (!rawId) return res.status(400).json({ error: "Missing deviceId" });

    // ✅ resolve device by UUID or external_id (scoped to estate)
    let dev: any = null;

    if (isUuid(rawId)) {
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, estate_id, home_id, external_id, vendor, adapter, online, status, metadata, last_seen_at, last_event_at, updated_at")
        .eq("id", rawId)
        .eq("estate_id", estateId)
        .maybeSingle();
      dev = data;
    } else {
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, estate_id, home_id, external_id, vendor, adapter, online, status, metadata, last_seen_at, last_event_at, updated_at")
        .eq("external_id", rawId)
        .eq("estate_id", estateId)
        .maybeSingle();
      dev = data;
    }

    if (!dev?.id) {
      return res.status(404).json({ error: "Device not found", deviceId: rawId });
    }
    if (homeId && String(dev?.home_id || "") !== String(homeId)) {
      return res.status(403).json({ error: "This device is not assigned to your current home." });
    }

    // 1) ✅ try cached/latest known state
    const { data: st } = await supabaseAdmin
      .from("device_states")
      .select("device_id, status, last_seen, updated_at")
      .eq("device_id", dev.id)
      .maybeSingle();

    if (st?.status) {
      const timeline = buildDeviceTimeline(dev, st);
      const summary = summarizeDeviceFrontendContract(dev, st);
      return res.json({
        deviceId: st.device_id,
        external_id: dev.external_id,
        vendor: dev.vendor ?? dev.adapter ?? null,
        state: st.status,
        normalized_state: summary.normalized_state,
        capabilities: summary.capabilities,
        supported_controls: summary.supported_controls,
        control_profile: summary.control_profile,
        health_status: summary.health_status,
        provider_health: summary.provider_health,
        primary_state: summary.primary_state,
        telemetry_summary: summary.telemetry_summary,
        device_family: summary.device_family,
        device_type: summary.device_type,
        last_signal: summary.last_signal,
        activity_summary: summary.activity_summary,
        lastSeen: st.last_seen,
        timeline,
        source: "cache",
      });
    }

    // 2) ✅ no state yet => fetch live from adapter (Tuya), then save
    initAdaptersOnce();

    // ✅ Prefer dev.adapter (if you ever store it), else dev.vendor, else "tuya"
    const adapterName = String(dev.adapter || dev.vendor || "tuya")
      .toLowerCase()
      .trim();

    const adapter = adapterRegistry.get(adapterName);

    // If adapter missing, return empty but not 404 (so UI won’t crash)
    if (!adapter) {
      return res.json({
        deviceId: dev.id,
        external_id: dev.external_id,
        vendor: dev.vendor ?? null,
        adapter: adapterName,
        state: {},
        lastSeen: null,
        source: "none",
        warning: `No adapter registered for adapterName=${adapterName}`,
      });
    }

    // Tuya uses external_id as the real device id on Tuya cloud
    const tuyaDeviceId = String(dev.external_id || "").trim();

    if (!tuyaDeviceId) {
      return res.json({
        deviceId: dev.id,
        external_id: dev.external_id ?? null,
        vendor: dev.vendor ?? null,
        adapter: adapterName,
        state: {},
        lastSeen: null,
        source: "none",
        warning: "Device has no external_id; cannot fetch live state from Tuya",
      });
    }

    let live: Record<string, any> = {};

    try {
      // You updated TuyaAdapter to support live status
      // @ts-ignore
      if (typeof (adapter as any).getLiveState === "function") {
        // @ts-ignore
        live = await (adapter as any).getLiveState(tuyaDeviceId);
      } else {
        throw new Error(`Adapter ${adapterName} does not implement getLiveState()`);
      }
    } catch (e: any) {
      // return empty (don’t 500 the UI), but include debug note
      return res.json({
        deviceId: dev.id,
        external_id: dev.external_id,
        vendor: dev.vendor ?? null,
        adapter: adapterName,
        state: {},
        lastSeen: null,
        source: "live_failed",
        error: e?.message || String(e),
      });
    }

    const now = new Date().toISOString();

    // 3) ✅ persist latest known state
    const liveOccurredAt = new Date().toISOString();
    const enrichedLive = enrichDeviceProviderState({
      state: {
        ...live,
        _oyi_timeline: {
          received_at: liveOccurredAt,
          provider_reported_at: null,
          source: "live_poll",
        },
      },
      metadata: dev?.metadata || {},
      device: {
        type: dev?.status || dev?.metadata?.type,
        category: dev?.metadata?.category,
        name: dev?.metadata?.name,
        provider: dev?.vendor || dev?.adapter || "tuya",
        adapter: dev?.adapter || dev?.vendor || "tuya",
      },
      provider: String(dev?.vendor || dev?.adapter || "tuya"),
      adapter: adapterName,
    });
    await supabaseAdmin.from("device_states").upsert(
      {
        device_id: dev.id, // store by our internal device UUID
        status: enrichedLive, // jsonb
        last_seen: liveOccurredAt,
      },
      { onConflict: "device_id" }
    );

    // 4) ✅ return live state
    const timeline = buildDeviceTimeline(dev, { status: enrichedLive, last_seen: liveOccurredAt, updated_at: liveOccurredAt });
    const summary = summarizeDeviceFrontendContract(dev, { status: enrichedLive, last_seen: liveOccurredAt, updated_at: liveOccurredAt });
    return res.json({
      deviceId: dev.id,
      external_id: dev.external_id,
      vendor: dev.vendor ?? null,
      adapter: adapterName,
      state: enrichedLive,
      normalized_state: summary.normalized_state,
      capabilities: summary.capabilities,
      supported_controls: summary.supported_controls,
      control_profile: summary.control_profile,
      health_status: summary.health_status,
      provider_health: summary.provider_health,
      primary_state: summary.primary_state,
      telemetry_summary: summary.telemetry_summary,
      device_family: summary.device_family,
      device_type: summary.device_type,
      last_signal: summary.last_signal,
      activity_summary: summary.activity_summary,
      lastSeen: liveOccurredAt,
      timeline,
      source: "live",
    });
  } catch (err: any) {
    console.error("getDeviceState error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
