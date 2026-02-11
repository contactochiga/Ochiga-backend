// src/controllers/deviceStateController.ts
import { Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function getDeviceState(req: any, res: Response) {
  try {
    const estateId = req.user?.estate_id;
    if (!estateId) return res.status(400).json({ error: "User has no estate" });

    const rawId = String(req.params.deviceId || "").trim();
    if (!rawId) return res.status(400).json({ error: "Missing deviceId" });

    // ✅ resolve device by UUID or external_id (scoped to estate)
    let dev: any = null;

    if (isUuid(rawId)) {
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, estate_id, external_id, vendor")
        .eq("id", rawId)
        .eq("estate_id", estateId)
        .maybeSingle();
      dev = data;
    } else {
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, estate_id, external_id, vendor")
        .eq("external_id", rawId)
        .eq("estate_id", estateId)
        .maybeSingle();
      dev = data;
    }

    if (!dev?.id) {
      return res.status(404).json({ error: "Device not found", deviceId: rawId });
    }

    // 1) ✅ try cached/latest known state
    const { data: st } = await supabaseAdmin
      .from("device_states")
      .select("device_id, status, last_seen")
      .eq("device_id", dev.id)
      .maybeSingle();

    if (st?.status) {
      return res.json({
        deviceId: st.device_id,
        external_id: dev.external_id,
        vendor: dev.vendor,
        state: st.status,
        lastSeen: st.last_seen,
        source: "cache",
      });
    }

    // 2) ✅ no state yet => fetch live from adapter (Tuya), then save
    initAdaptersOnce();

    const vendor = String(dev.vendor || "").toLowerCase().trim() || "tuya";
    const adapter = adapterRegistry.get(vendor);

    // If adapter missing, return empty but not 404 (so UI won’t crash)
    if (!adapter) {
      return res.json({
        deviceId: dev.id,
        external_id: dev.external_id,
        vendor: dev.vendor,
        state: {},
        lastSeen: null,
        source: "none",
        warning: `No adapter registered for vendor=${vendor}`,
      });
    }

    // Tuya uses external_id as the real device id on Tuya cloud
    const tuyaDeviceId = String(dev.external_id || "").trim();

    let live: Record<string, any> = {};
    try {
      // You already updated TuyaAdapter to support live status
      // @ts-ignore
      if (typeof (adapter as any).getLiveState === "function") {
        // @ts-ignore
        live = await (adapter as any).getLiveState(tuyaDeviceId);
      } else {
        // fallback: try calling Tuya status endpoint via generic client method if you exposed it
        throw new Error(`Adapter ${vendor} does not implement getLiveState()`);
      }
    } catch (e: any) {
      // return empty (don’t 500 the UI), but include debug note
      return res.json({
        deviceId: dev.id,
        external_id: dev.external_id,
        vendor: dev.vendor,
        state: {},
        lastSeen: null,
        source: "live_failed",
        error: e?.message || String(e),
      });
    }

    const now = new Date().toISOString();

    // 3) ✅ persist latest known state
    await supabaseAdmin
      .from("device_states")
      .upsert(
        {
          device_id: dev.id, // store by our internal device UUID
          status: live,       // jsonb
          last_seen: now,
        },
        { onConflict: "device_id" }
      );

    // 4) ✅ return live state
    return res.json({
      deviceId: dev.id,
      external_id: dev.external_id,
      vendor: dev.vendor,
      state: live,
      lastSeen: now,
      source: "live",
    });
  } catch (err: any) {
    console.error("getDeviceState error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
