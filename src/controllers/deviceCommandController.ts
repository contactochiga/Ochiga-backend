// src/controllers/deviceCommandController.ts
import { Request, Response } from "express";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";

export async function requestDeviceCommand(req: Request, res: Response) {
  try {
    const deviceId = String(req.params.deviceId || "");
    const command = req.body?.command;

    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });
    if (!command) return res.status(400).json({ error: "command is required" });

    const user = req.user as any;
    if (!user?.id) return res.status(401).json({ error: "Not authenticated" });

    await handleSignal({
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      source: "user",
      type: "device.command.requested",
      timestamp: new Date().toISOString(),
      deviceId,
      command,
      requestedBy: {
        userId: user.id,
        role: user.role,
      },
    });

    return res.status(202).json({ ok: true, status: "command_queued" });
  } catch (e: any) {
    console.error("requestDeviceCommand error:", e?.message || e);
    return res.status(500).json({
      error: "Command failed",
      details: e?.message || String(e),
    });
  }
}
