// src/controllers/deviceDiscoveryController.ts

import { Request, Response } from "express";
import { TuyaAdapter } from "../device/adapters/tuya/TuyaAdapter";
import { AdapterContext } from "../device/adapters/types";

/**
 * Generic device discovery entrypoint
 * Supports multiple adapters via query param
 *
 *   GET /devices/discover?adapter=tuya
 */
export async function discoverDevices(req: Request, res: Response) {
  const user = req.user!;
  const adapterName = String(req.query.adapter || "").toLowerCase();

  if (!user?.estate_id) {
    return res.status(400).json({ error: "User has no estate" });
  }

  if (!adapterName) {
    return res.status(400).json({
      error: "adapter query param required (e.g. ?adapter=tuya)",
    });
  }

  // -------------------------------
  // Adapter context (boundary-safe)
  // -------------------------------
  const context: AdapterContext = {
    estateId: user.estate_id,
    homeId: user.home_id,
    userId: user.id,
    credentials: {
      apiKey: process.env.TUYA_ACCESS_ID,
      apiSecret: process.env.TUYA_ACCESS_SECRET,
    },
  };

  // -------------------------------
  // Adapter selection
  // -------------------------------
  let adapter;

  switch (adapterName) {
    case "tuya":
      adapter = new TuyaAdapter();
      break;

    default:
      return res.status(400).json({
        error: `Unsupported adapter: ${adapterName}`,
      });
  }

  // -------------------------------
  // Discover devices
  // -------------------------------
  const devices = await adapter.discover(context);

  return res.json({
    adapter: adapterName,
    count: devices.length,
    devices,
  });
}
