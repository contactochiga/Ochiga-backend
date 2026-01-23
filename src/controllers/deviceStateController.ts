import { Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

export async function getDeviceState(req: any, res: Response) {
  try {
    const estateId = req.user?.estate_id;
    if (!estateId) return res.status(400).json({ error: "User has no estate" });

    const { deviceId } = req.params;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });

    // ✅ make sure device belongs to this estate
    const { data: dev, error: devErr } = await supabaseAdmin
      .from("devices")
      .select("id, estate_id")
      .eq("id", deviceId)
      .limit(1)
      .single();

    if (devErr) return res.status(404).json({ error: "Device not found" });
    if (dev?.estate_id !== estateId) return res.status(403).json({ error: "Forbidden" });

    // ✅ read latest known state
    const { data: st, error: stErr } = await supabaseAdmin
      .from("device_states")
      .select("device_id, status, last_seen")
      .eq("device_id", deviceId)
      .limit(1)
      .single();

    if (stErr || !st) {
      return res.status(404).json({
        error: "No state yet for this device",
        deviceId,
      });
    }

    return res.json({
      deviceId: st.device_id,
      state: st.status,
      lastSeen: st.last_seen,
    });
  } catch (err: any) {
    console.error("getDeviceState error:", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
