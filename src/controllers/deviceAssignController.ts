// src/controllers/deviceAssignController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

function cleanText(v: any) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function isUuid(v: any) {
  const s = String(v ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s
  );
}

/**
 * POST /devices/assign
 * Consumer claims devices into home context.
 *
 * Accepts either:
 *  - { deviceIds: string[], room?: string }        // Tuya ids only
 *  - { devices: any[], room?: string }            // TuyaAdapter.discover objects
 *
 * IMPORTANT:
 * - devices.id is UUID in DB, so we DO NOT set id.
 * - Upsert uses (vendor, external_id) unique index.
 */
export async function assignDevices(req: Request, res: Response) {
  try {
    const user: any = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    if (!user.estate_id) return res.status(400).json({ error: "User has no estate" });
    if (!user.home_id) return res.status(400).json({ error: "User has no home" });

    const roomRaw = cleanText(req.body?.room); // could be uuid or label

    const incomingDevices = Array.isArray(req.body?.devices) ? req.body.devices : null;
    const deviceIds = Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : null;

    if ((!incomingDevices || incomingDevices.length === 0) && (!deviceIds || deviceIds.length === 0)) {
      return res.status(400).json({ error: "Provide devices[] or deviceIds[]" });
    }

    const items = incomingDevices || deviceIds!.map((id: string) => ({ externalId: id, id }));

    const rows = items
      .map((d: any) => {
        // Support TuyaAdapter.discover() output:
        // { externalId, adapter, name, category, online, metadata }
        const vendor = cleanText(d.adapter || d.vendor || "tuya") || "tuya";

        const externalId =
          cleanText(d.externalId) ||
          cleanText(d.external_id) ||
          cleanText(d.dev_id) ||
          cleanText(d.vendor_device_id) ||
          cleanText(d.id);

        if (!externalId) return null;

        const name =
          cleanText(d.name) ||
          cleanText(d.device_name) ||
          cleanText(d.product_name) ||
          "Device";

        const type =
          cleanText(d.category) ||
          cleanText(d.type) ||
          "device";

        const online = typeof d.online === "boolean" ? d.online : undefined;

        const meta = d.metadata || d.meta || d;

        const row: any = {
          vendor,
          external_id: externalId,

          estate_id: user.estate_id,
          home_id: user.home_id,

          name,
          type,

          status: cleanText(d.status) || (online === true ? "online" : online === false ? "offline" : "assigned"),
          ip: cleanText(d.ip) || cleanText(d.metadata?.ip) || null,
          protocol: cleanText(d.protocol) || (Array.isArray(d.protocols) ? cleanText(d.protocols[0]) : null),

          meta,
          updated_at: new Date().toISOString(),
        };

        // ✅ room_id is UUID in your DB (you have idx_devices_room on room_id)
        // If frontend sends "Living Room" (not uuid), don't write room_id.
        if (roomRaw) {
          if (isUuid(roomRaw)) row.room_id = roomRaw;
          else row.meta = { ...(row.meta || {}), room_label: roomRaw };
        }

        return row;
      })
      .filter(Boolean);

    if (rows.length === 0) return res.status(400).json({ error: "No valid devices to assign" });

    const { data, error } = await supabaseAdmin
      .from("devices")
      .upsert(rows, { onConflict: "vendor,external_id" })
      .select("*");

    if (error) {
      console.error("assignDevices upsert error:", error);
      return res.status(500).json({
        error: error.message,
        hint: "Ensure devices_vendor_external_id_uniq index exists on (vendor, external_id).",
      });
    }

    return res.json({ ok: true, devices: data || [] });
  } catch (e: any) {
    console.error("assignDevices error:", e);
    return res.status(500).json({ error: e?.message || "Assign failed" });
  }
}
