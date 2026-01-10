// src/controllers/deviceDiscoveryController.ts

import { Request, Response } from "express";
import { TuyaAdapter } from "../device/adapters/tuya/TuyaAdapter";
import { AdapterContext } from "../device/adapters/types";

export async function discoverDevices(req: Request, res: Response) {
  const user = req.user!;

  if (!user.estate_id) {
    return res.status(400).json({
      error: "User is not attached to an estate",
    });
  }

  const context: AdapterContext = {
    estateId: user.estate_id, // ✅ now guaranteed string
    userId: user.id,
    credentials: {
      apiKey: process.env.TUYA_ACCESS_ID,
      apiSecret: process.env.TUYA_ACCESS_SECRET,
      baseUrl: process.env.TUYA_BASE_URL,
    },
  };

  try {
    const adapter = new TuyaAdapter(context);
    const devices = await adapter.discover(context);

    res.json({ devices });
  } catch (err: any) {
    console.error("Device discovery failed", err);
    res.status(500).json({
      error: err.message || "Discovery failed",
    });
  }
}
