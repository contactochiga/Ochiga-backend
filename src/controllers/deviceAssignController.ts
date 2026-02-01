// src/controllers/deviceAssignController.ts

import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";

function cleanRoomName(room?: any) {
  const r = String(room || "").trim();
  return r.length ? r : null;
}

/**
 * POST /devices/assign
 * Consumer claims devices into home context.
 *
 * Accepts:
 *  - { deviceIds: string[], room?: string }
 *  - { devices: any[], room?: string }  // optional richer payload
 */
export async function assignDevices(req: Request, res: Response) {
  try {
    const user = req.user as any;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    if (!user.estate_id) return res.status(400).json({ error: "User has no estate" });
    if (!user.home_id) return res.status(400).json({ error: "User has no home" });

    const roomName = cleanRoomName(req.body?.room);

    const incomingDevices = Array.isArray(req.body?.devices) ? req.body.devices : null;
    const deviceIds = Array.isArray(req.body?.deviceIds) ? req.body.deviceIds : null;

    if ((!incomingDevices || incomingDevices.length === 0) && (!deviceIds || deviceIds.length === 0)) {
      return res.status(400).json({ error: "Provide devices[] or deviceIds[]" });
    }

    // --------------------------------------------------
    // ✅ Resolve room_id from room name (optional)
    // --------------------------------------------------
    let room_id: string | null = null;

    if (roomName) {
      const { data: roomRow, error: roomErr } = await supabaseAdmin
        .from("rooms")
        .select("id")
        .eq("home_id", user.home_id)
        .ilike("name", roomName) // allows "living room" vs "Living Room"
        .limit(1)
        .maybeSingle();

      if (roomErr) {
        // Not fatal — just means we can't map the room
        console.warn("assignDevices: room lookup error:", roomErr);
      } else {
        room_id = roomRow?.id ?? null;
      }
    }

    // --------------------------------------------------
    // ✅ Build safe rows for public.devices
    // (NO ip/protocol/created_at/updated_at assumptions)
    // --------------------------------------------------
    const inputList = incomingDevices || deviceIds!.map((id: string) => ({ external_id: id }));

    const rows = inputList.map((d: any) => {
      // vendor / adapter
      const vendor = String(d.vendor || d.adapter || "tuya").toLowerCase();

      // external id (Tuya device id)
      const external =
        d.external_id ||
        d.externalId ||
        d.dev_id ||
        d.device_id ||
        d.id ||
        d.uuid;

      if (!external) {
        throw new Error("Device missing external id");
      }

      const name =
        d.name ||
        d.device_name ||
        d.product_name ||
        "Device";

      const type =
        d.type ||
        d.category ||
        d.device_type ||
        "device";

      return {
        // identity
        vendor,
        external_id: String(external),

        // ownership scope
        estate_id: user.estate_id,
        home_id: user.home_id,

        // room binding (nullable)
        room_id,

        // display
        name: String(name),
        type: String(type),
        status: d.status ? String(d.status) : "assigned",

        // metadata payload
        meta: d.meta || d,
      };
    });

    // --------------------------------------------------
    // ✅ Upsert by (vendor, external_id)
    // NOTE: requires a UNIQUE constraint/index on (vendor, external_id)
    // --------------------------------------------------
    const { data, error } = await supabaseAdmin
      .from("devices")
      .upsert(rows, { onConflict: "vendor,external_id" })
      .select("*");

    if (error) {
      console.error("assignDevices upsert error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      ok: true,
      message: "Devices assigned",
      room_id,
      count: data?.length || 0,
      devices: data || [],
    });
  } catch (e: any) {
    console.error("assignDevices error:", e);
    return res.status(500).json({ error: e?.message || "Assign failed" });
  }
}
