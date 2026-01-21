// src/controllers/deviceDiscoveryController.ts

import { Request, Response } from "express";
import { AdapterContext } from "../device/adapters/types";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";

/**
 * Generic device discovery entrypoint
 * Supports multiple adapters via query param
 *
 *   GET /facility/devices/discover?adapter=tuya
 *   GET /facility/devices/discover?adapter=ssdp
 *   GET /facility/devices/discover?adapter=onvif&cidr=192.168.1.0/24
 *   GET /facility/devices/discover?adapter=ipscan&cidr=192.168.1.0/24
 */
export async function discoverDevices(req: Request, res: Response) {
  try {
    initAdaptersOnce();

    const user = req.user!;
    const adapterName = String(req.query.adapter || "").toLowerCase().trim();

    if (!user?.estate_id) {
      return res.status(400).json({ error: "User has no estate" });
    }

    if (!adapterName) {
      return res.status(400).json({
        error: "adapter query param required (e.g. ?adapter=tuya)",
      });
    }

    const context: AdapterContext = {
      estateId: user.estate_id,
      homeId: user.home_id,
      userId: user.id,
      credentials: {
        // Tuya cloud
        apiKey: process.env.TUYA_ACCESS_ID,
        apiSecret: process.env.TUYA_ACCESS_SECRET,

        // Network discovery
        cidr: req.query.cidr ? String(req.query.cidr) : undefined,
        timeoutMs: req.query.timeoutMs ? Number(req.query.timeoutMs) : undefined,

        // ONVIF optional credentials
        onvifUser: req.query.onvifUser ? String(req.query.onvifUser) : undefined,
        onvifPass: req.query.onvifPass ? String(req.query.onvifPass) : undefined,
      },
    };

    let adapter;
    try {
      adapter = adapterRegistry.get(adapterName);
    } catch {
      return res.status(400).json({
        error: `Unsupported adapter: ${adapterName}`,
        supported: adapterRegistry.list().map((a) => a.name),
      });
    }

    const devices = await adapter.discover(context);

    return res.json({
      adapter: adapterName,
      count: devices.length,
      devices,
    });
  } catch (err: any) {
    console.error("discoverDevices error:", err);
    return res.status(500).json({ error: err?.message || "Discovery failed" });
  }
}
