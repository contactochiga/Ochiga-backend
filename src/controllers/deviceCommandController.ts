// src/controllers/deviceCommandController.ts
import { Request, Response } from "express";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";

/**
 * POST /devices/:deviceId/command
 * body: { command: { ... } }
 *
 * deviceId can be:
 *  - devices.id (uuid)
 *  - devices.external_id (tuya dev_id)
 *
 * We resolve the actual device row to enforce home scoping and to pass stable ids.
 */
export async function requestDeviceCommand(req: Request, res: Response) {
  try {
    const user: any = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });
    if (!user?.home_id) return res.status(400).json({ error: "User has no home" });

    const rawDeviceId = String(req.params.deviceId || "").trim();
    if (!rawDeviceId) return res.status(400).json({ error: "deviceId is required" });

    const command = req.body?.command;
    if (!command || typeof command !== "object") {
      return res.status(400).json({ error: "Body must include { command: { ... } }" });
    }

    // ✅ Resolve device by uuid OR external_id, scoped to the user home
    const { data: device, error: devErr } = await supabaseAdmin
      .from("devices")
      .select("id, external_id, vendor, home_id, room_id, name, type")
      .or(`id.eq.${rawDeviceId},external_id.eq.${rawDeviceId}`)
      .eq("home_id", user.home_id)
      .maybeSingle();

    if (devErr) return res.status(500).json({ error: devErr.message });
    if (!device) return res.status(404).json({ error: "Device not found in this home" });

    // Emit signal → your event processor/worker will do the actual adapter call
    await handleSignal({
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "user",
      type: "device.command.requested",
      timestamp: new Date().toISOString(),

      // ✅ Use both ids
      deviceId: device.id,                 // internal uuid
      externalDeviceId: device.external_id, // tuya dev_id
      vendor: device.vendor || "tuya",

      command,

      requestedBy: {
        userId: user.id,
        role: user.role,
      },

      context: {
        homeId: user.home_id,
        roomId: device.room_id,
      },
    } as any);

    return res.status(202).json({ ok: true, status: "command_queued", device });
  } catch (e: any) {
    console.error("requestDeviceCommand error:", e);
    return res.status(500).json({ error: e?.message || "Command queue failed" });
  }
}
