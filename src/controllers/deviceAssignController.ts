// src/controllers/deviceAssignController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

function cleanRoom(room?: any) {
  const r = String(room || "").trim();
  return r.length ? r : null;
}

/**
 * POST /devices/assign
 * Consumer claims devices into home context.
 *
 * Accepts either:
 *  - { deviceIds: string[], room?: string }
 *  - { devices: any[], room?: string }  // richer
 */
export async function assignDevices(req: Request, res: Response) {
  try {
    const user = req.user!;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    if (!user.estate_id) return res.status(400).json({ error: "User has no estate" });
    if (!user.home_id) return res.status(400).json({ error: "User has no home" });

    const room = cleanRoom(req.body?.room);

    const incomingDevices = Array.isArray(req.body?.devices) ? req.body.devices : null;
    const deviceIds = Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : null;

    if ((!incomingDevices || incomingDevices.length === 0) && (!deviceIds || deviceIds.length === 0)) {
      return res.status(400).json({ error: "Provide devices[] or deviceIds[]" });
    }

    // Build rows for upsert into public.devices
    // Assumption: you have a public.devices table. (You already use /devices/estate/:estateId, so you do.)
    const rows = (incomingDevices || deviceIds!.map((id: string) => ({ id }))).map((d: any) => {
      // normalize IDs (tuya uses dev_id / id)
      const vendor = d.vendor || d.adapter || "tuya";
      const vendor_device_id = d.vendor_device_id || d.dev_id || d.id;

      // Choose a stable external key
      const externalId = vendor_device_id || d.id;

      return {
        // If your devices table uses UUID id, DON’T set id here.
        // If your devices table uses text id, this is ok.
        // We'll use external_id for safety.
        external_id: String(externalId),
        vendor: String(vendor),

        estate_id: user.estate_id,
        home_id: user.home_id,
        room: room,

        name: d.name || d.device_name || d.product_name || "Device",
        type: d.type || d.category || "device",
        ip: d.ip || null,
        protocol: d.protocol || null,
        status: d.status || "assigned",

        meta: d.meta || d,

        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
    });

    // ✅ Upsert by (vendor, external_id)
    const { data, error } = await supabaseAdmin
      .from("devices")
      .upsert(rows, { onConflict: "vendor,external_id" })
      .select("*");

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, devices: data || [] });
  } catch (e: any) {
    console.error("assignDevices error:", e);
    return res.status(500).json({ error: e?.message || "Assign failed" });
  }
}
