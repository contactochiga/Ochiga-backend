import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { syncTuyaRegistryForActor } from "../services/tuyaRegistrySyncService";
import { resolveRequestContext } from "../middleware/contextResolver";

const router = Router();

router.post("/tuya/sync", requireAuth, resolveRequestContext, requirePermission("devices.read"), async (req, res) => {
  try {
    return res.json(await syncTuyaRegistryForActor({
      ...(req.user as any),
      estate_id: (req as any).oisContext?.estate_id || (req.user as any)?.estate_id,
      home_id: (req as any).oisContext?.home_id || (req.user as any)?.home_id,
    }, req));
  } catch (error: any) {
    const message = error?.message || "Tuya sync failed";
    const status = message.includes("not linked") ? 409 : message.includes("estate context") ? 400 : 502;
    return res.status(status).json({ ok: false, provider: "tuya", error: message });
  }
});

export default router;
