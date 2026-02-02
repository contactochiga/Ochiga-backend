// src/controllers/deviceCommandController.ts
import { Request, Response } from "express";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { supabaseAdmin } from "../supabase/supabaseClient";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function requestDeviceCommand(req: Request, res: Response) {
  try {
    const rawId = String(req.params.deviceId || "").trim();
    const command = req.body?.command;

    if (!rawId) return res.status(400).json({ error: "deviceId is required" });
    if (!command) return res.status(400).json({ error: "command is required" });

    const user = (req as any).user;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    // 🔥 Normalize device reference: allow UUID or external_id
    let deviceRow: any = null;

    if (isUuid(rawId)) {
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, vendor, external_id, estate_id, home_id, room_id")
        .eq("id", rawId)
        .maybeSingle();
      deviceRow = data;
    } else {
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, vendor, external_id, estate_id, home_id, room_id")
        .eq("external_id", rawId)
        .maybeSingle();
      deviceRow = data;
    }

    // If not found, still queue — but worker will fallback and likely fail safely
    const deviceRef = deviceRow?.id || rawId;

    await handleSignal({
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "user",
      type: "device.command.requested",
      timestamp: new Date().toISOString(),
      deviceId: deviceRef, // ✅ now mostly a UUID
      command,
      requestedBy: {
        userId: user.id,
        role: user.role,
      },
      // OPTIONAL: give worker a hint
      metadata: {
        raw_device_ref: rawId,
        resolved_device_uuid: deviceRow?.id || null,
      },
    });

    return res.status(202).json({
      ok: true,
      status: "command_queued",
      device: deviceRow
        ? { id: deviceRow.id, external_id: deviceRow.external_id, vendor: deviceRow.vendor }
        : { ref: rawId },
    });
  } catch (e: any) {
    console.error("requestDeviceCommand error:", e?.message || e);
    return res.status(500).json({
      error: "Command failed",
      details: e?.message || String(e),
    });
  }
}
