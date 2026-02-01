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
 * Accepts:
 *  - { deviceIds: string[], room?: string }           (IDs only)
 *  - { devices: any[], room?: string }               (rich objects)
 *
 * IMPORTANT:
 * - Don't write columns that might not exist (created_at/updated_at).
 * - Upsert conflict key MUST match a real unique constraint in your DB.
 */
export async function assignDevices(req: Request, res: Response) {
  try {
    const user: any = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    if (!user.estate_id) return res.status(400).json({ error: "User has no estate" });
    if (!user.home_id) return res.status(400).json({ error: "User has no home" });

    const roomRaw = cleanText(req.body?.room);

    const incomingDevices = Array.isArray(req.body?.devices) ? req.body.devices : null;
    const deviceIds = Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : null;

    if ((!incomingDevices || incomingDevices.length === 0) && (!deviceIds || deviceIds.length === 0)) {
      return res.status(400).json({ error: "Provide devices[] or deviceIds[]" });
    }

    // Normalize into a list of device objects
    const normalized = (incomingDevices || deviceIds!.map((id: string) => ({ externalId: id, id }))).map((d: any) => {
      // Support TuyaAdapter.discover() output:
      // { externalId, adapter, name, category, online, metadata }
      const adapter = cleanText(d.adapter || d.vendor || "tuya") || "tuya";

      // external identifier (MUST be stable)
      const externalId =
        cleanText(d.externalId) ||
        cleanText(d.external_id) ||
        cleanText(d.vendor_device_id) ||
        cleanText(d.dev_id) ||
        cleanText(d.id);

      if (!externalId) {
        return null;
      }

      const name =
        cleanText(d.name) ||
        cleanText(d.device_name) ||
        cleanText(d.product_name) ||
        "Device";

      const type =
        cleanText(d.type) ||
        cleanText(d.category) ||
        cleanText(d.device_type) ||
        "device";

      const online =
        typeof d.online === "boolean" ? d.online : undefined;

      // raw/meta bucket
      const meta = d.metadata || d.meta || d;

      // Build a "safe" row:
      // Keep it to columns you VERY LIKELY have: estate_id, home_id, name, type, status, protocol, meta, external_id/vendor
      const row: any = {
        estate_id: user.estate_id,
        home_id: user.home_id,

        // These are common in your project already
        name,
        type,

        // Store adapter/vendor + external id (best practice)
        vendor: adapter,
        external_id: externalId,

        // optional fields
        protocol: cleanText(d.protocol) || (Array.isArray(d.protocols) ? cleanText(d.protocols[0]) : null),
        ip: cleanText(d.ip) || cleanText(d.metadata?.ip) || null,
        status: cleanText(d.status) || (online === true ? "online" : online === false ? "offline" : "assigned"),

        // jsonb
        meta,
      };

      // Room handling: support either UUID room_id or text room
      // If your devices table DOES NOT have room_id/room columns, remove whichever doesn’t exist.
      if (roomRaw) {
        if (isUuid(roomRaw)) row.room_id = roomRaw;
        else row.room = roomRaw;
      }

      return row;
    }).filter(Boolean);

    if (normalized.length === 0) {
      return res.status(400).json({ error: "No valid devices to assign" });
    }

    /**
     * ✅ Upsert conflict key
     * You MUST have a unique constraint/index on this key.
     * Recommended DB unique index: UNIQUE(vendor, external_id)
     *
     * If your DB only has external_id unique, change to: onConflict: "external_id"
     */
    const { data, error } = await supabaseAdmin
      .from("devices")
      .upsert(normalized, { onConflict: "vendor,external_id" })
      .select("*");

    if (error) {
      // Helpful debug output
      console.error("assignDevices upsert error:", error);
      return res.status(500).json({
        error: error.message,
        hint: "Check devices table columns + unique constraint for (vendor, external_id).",
      });
    }

    return res.json({ ok: true, devices: data || [] });
  } catch (e: any) {
    console.error("assignDevices error:", e);
    return res.status(500).json({ error: e?.message || "Assign failed" });
  }
}
