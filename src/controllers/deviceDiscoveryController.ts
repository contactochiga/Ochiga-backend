// src/controllers/deviceDiscoveryController.ts

import { Request, Response } from "express";
import { AdapterContext } from "../device/adapters/types";
import { TuyaAdapter } from "../device/adapters/tuya/TuyaAdapter";

/**
 * Device Discovery Controller
 * ----------------------------------------
 * Entry point for discovering devices via adapters
 * (Tuya, WiFi, BLE, Zigbee, MQTT, etc.)
 *
 * NO protocol logic lives here.
 * NO network scanning lives here.
 */
export async function discoverDevices(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    /**
     * Adapter selector
     * Example:
     *   /devices/discover?adapter=tuya
     */
    const adapterType = (req.query.adapter as string) || "tuya";

    let adapter;

    switch (adapterType) {
      case "tuya":
        adapter = new TuyaAdapter();
        break;

      default:
        return res.status(400).json({
          error: `Unsupported adapter '${adapterType}'`,
        });
    }

    /**
     * Adapter execution context
     * (security + boundary control)
     */
    const context: AdapterContext = {
      estateId: user.estate_id,
      userId: user.id,
      homeId: user.home_id,
      credentials: {
        // Tuya credentials are currently read from ENV
        // Other adapters may require gatewayId, tokens, etc.
      },
    };

    /**
     * Perform discovery
     */
    const devices = await adapter.discover(context);

    return res.json({
      adapter: adapterType,
      count: devices.length,
      devices,
    });
  } catch (err: any) {
    console.error("Device discovery failed:", err);
    return res.status(500).json({
      error: "Device discovery failed",
      message: err.message,
    });
  }
}
