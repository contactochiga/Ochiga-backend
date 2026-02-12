// src/controllers/deviceEstateController.ts
import type { Request, Response } from "express";
import { TuyaAdapter } from "../device/adapters/tuya/TuyaAdapter"; // adjust path if needed

export async function getEstateDevices(req: Request, res: Response) {
  try {
    const estateId = req.params.estateId;

    // ✅ You can enforce access rules here if you want:
    // if ((req as any).user?.estate_id !== estateId) return res.status(403).json({ error: "Forbidden" });

    /**
     * TODO (later): fetch "assigned devices" from DB for this estateId.
     * For now, return discovery so UI can load devices and you move forward.
     */
    const user = (req as any).user || {};

    const adapter = new TuyaAdapter();
    const devices = await adapter.discover({
      estateId,
      homeId: user?.home_id ?? user?.homeId,
      userId: user?.id ?? user?.userId,
      credentials: {
        tuyaUid: user?.tuya_uid ?? user?.tuyaUid, // must exist for UID discovery
      },
    } as any);

    // Return an array (your frontend expects list/array)
    return res.json(devices);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed to fetch estate devices" });
  }
}
