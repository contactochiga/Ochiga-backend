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
    const rawDeviceId = String(req.params.deviceId || "");
    const command = req.body?.command;

    if (!rawDeviceId) return res.status(400).json({ error: "deviceId is required" });
    if (!command || typeof command !== "object")
      return res.status(400).json({ error: "command is required (object)" });

    const user = req.user as any;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    // ------------------------------------------
    // Normalize device ID:
    // - if UUID: use it
    // - else: treat as external_id and resolve
    // ------------------------------------------
    let deviceUuid: string | null = null;
    let externalId: string | null = null;
    let vendor: string | null = null;

    if (isUuid(rawDeviceId)) {
      deviceUuid = rawDeviceId;
      const { data } = await supabaseAdmin
        .from("devices")
        .select("id, external_id, vendor")
        .eq("id", rawDeviceId)
        .maybeSingle();

      if (data) {
        externalId = data.external_id || null;
        vendor = data.vendor || null;
      }
    } else {
      externalId = rawDeviceId;

      const { data, error } = await supabaseAdmin
        .from("devices")
        .select("id, external_id, vendor")
        .eq("external_id", rawDeviceId)
        .maybeSingle();

      if (error) {
        console.warn("⚠️ device external_id lookup failed:", error.message);
      }

      if (!data?.id) {
        return res.status(404).json({
          error: "Device not found",
          details: "No device row matches this external_id",
          external_id: rawDeviceId,
        });
      }

      deviceUuid = data.id;
      vendor = data.vendor || null;
    }

    if (!deviceUuid) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Push into Control Plane as canonical UUID
    await handleSignal({
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "user",
      type: "device.command.requested",
      timestamp: new Date().toISOString(),
      deviceId: deviceUuid,
      command,
      requestedBy: {
        userId: user.id,
        role: user.role,
      },
      // Helpful metadata for workers + debugging
      metadata: {
        vendor,
        external_id: externalId,
      },
    } as any);

    return res.status(202).json({
      ok: true,
      status: "command_queued",
      deviceId: deviceUuid,
      external_id: externalId,
      vendor,
    });
  } catch (e: any) {
    console.error("requestDeviceCommand error:", e?.message || e);
    return res.status(500).json({
      error: "Command failed",
      details: e?.message || String(e),
    });
  }
}
