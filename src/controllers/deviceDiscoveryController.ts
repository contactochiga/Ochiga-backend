// src/controllers/deviceDiscoveryController.ts

import { Request, Response } from "express";
import { TuyaAdapter } from "../device/adapters/tuya/TuyaAdapter";
import { AdapterContext } from "../device/adapters/types";

export async function discoverDevices(req: Request, res: Response) {
  const user = req.user!;
  const { adapter = "tuya" } = req.query;

  let adapterInstance;

  switch (adapter) {
    case "tuya":
      adapterInstance = new TuyaAdapter();
      break;
    default:
      return res.status(400).json({ error: "Unknown adapter" });
  }

  const context: AdapterContext = {
    estateId: user.estate_id,
    userId: user.id,
    credentials: {
      // for now Tuya uses env vars
    },
  };

  const devices = await adapterInstance.discover(context);

  res.json({ devices });
}
