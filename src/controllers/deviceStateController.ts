// src/controllers/deviceStateController.ts
import { Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

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

    if (!dev?.id) return res.status(404).json({ error: "Device not found", deviceId: rawId });

    // ✅ read latest known state by UUID
    const { data: st } = await supabaseAdmin
      .from("device_states")
      .select("device_id, status, last_seen")
      .eq("device_id", dev.id)
      .maybeSingle();

    if (!st) {
      return res.status(404).json({
        error: "No state yet for this device",
        deviceId: dev.id,
        external_id: dev.external_id,
      });
    }

    return res.json({
      deviceId: st.device_id,
      external_id: dev.external_id,
      vendor: dev.vendor,
      state: st.status,
      lastSeen: st.last_seen,
    });
  } catch (err: any) {
    console.error("getDeviceState error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
