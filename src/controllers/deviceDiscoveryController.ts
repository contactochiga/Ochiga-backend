// src/controllers/deviceDiscoveryController.ts

import { Request, Response } from "express";
import { TuyaAdapter } from "../device/adapters/tuya/TuyaAdapter";
import { AdapterContext } from "../device/adapters/types";

export async function discoverTuyaDevices(req: Request, res: Response) {
  const user = req.user!;

  if (!user.estate_id) {
    return res.status(400).json({ error: "User has no estate" });
  }

  const context: AdapterContext = {
    estateId: user.estate_id,
    homeId: user.home_id,
    userId: user.id,
    credentials: {
      apiKey: process.env.TUYA_ACCESS_ID,
      apiSecret: process.env.TUYA_ACCESS_SECRET,
    },
  };

  const adapter = new TuyaAdapter(); // ✅ NO ARGUMENTS

  const devices = await adapter.discover(context);

  return res.json({
    adapter: "tuya",
    count: devices.length,
    devices,
  });
}
