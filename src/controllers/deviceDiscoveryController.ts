// src/controllers/deviceDiscoveryController.ts

import { Request, Response } from "express";
import { AdapterContext } from "../device/adapters/types";
import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";

/**
 * GET /devices/discover?adapter=tuya
 * ✅ adapter defaults to "tuya" if not provided
 */
export async function discoverDevices(req: Request, res: Response) {
  // ✅ HARD NO-CACHE (prevents 304 + empty body)
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  // ✅ prevent conditional requests from being honored
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");

  try {
    initAdaptersOnce();

    const user = req.user!;

    // ✅ DEFAULT to tuya so consumer discovery works without query param
    const adapterName = String(req.query.adapter || "tuya")
      .toLowerCase()
      .trim();

    if (!user?.estate_id) {
      return res.status(400).json({ error: "User has no estate" });
    }

    // ✅ TUYA UID (Smart Life account UID)
    // Priority: query param -> env -> empty
    const tuyaUid =
      (req.query.uid ? String(req.query.uid).trim() : "") ||
      (process.env.TUYA_TEST_UID ? String(process.env.TUYA_TEST_UID).trim() : "");

    const context: AdapterContext = {
      estateId: user.estate_id,
      homeId: user.home_id,
      userId: user.id,
      credentials: {
        apiKey: process.env.TUYA_ACCESS_ID,
        apiSecret: process.env.TUYA_ACCESS_SECRET,

        // ✅ PASS UID TO TUYA ADAPTER
        tuyaUid,

        cidr: req.query.cidr ? String(req.query.cidr) : undefined,
        timeoutMs: req.query.timeoutMs ? Number(req.query.timeoutMs) : undefined,

        onvifUser: req.query.onvifUser ? String(req.query.onvifUser) : undefined,
        onvifPass: req.query.onvifPass ? String(req.query.onvifPass) : undefined,
      } as any,
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

    // ✅ Helpful error if tuya discovery is used without UID
    if (adapterName === "tuya" && !tuyaUid) {
      return res.status(400).json({
        error:
          "Missing Tuya UID. Set TUYA_TEST_UID in env or call /devices/discover?adapter=tuya&uid=YOUR_UID",
      });
    }

    const devices = await adapter.discover(context);

    // ✅ always return a fresh body
    return res.status(200).json({
      adapter: adapterName,
      count: devices.length,
      devices,
      ts: Date.now(), // small change to ensure body differs
    });
  } catch (err: any) {
    console.error("discoverDevices error:", err);
    return res.status(500).json({ error: err?.message || "Discovery failed" });
  }
}
