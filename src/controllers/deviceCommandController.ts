import { Request, Response } from "express";
import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";

export async function requestDeviceCommand(req: Request, res: Response) {
  const { deviceId } = req.params;
  const { command } = req.body;
  const user = req.user!;

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

  res.status(202).json({ status: "command_queued" });
}
