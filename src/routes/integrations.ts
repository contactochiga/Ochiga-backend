import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { syncTuyaRegistryForActor } from "../services/tuyaRegistrySyncService";

const router = Router();

router.post("/tuya/sync", requireAuth, requirePermission("devices.read"), async (req, res) => {
  try {
    return res.json(await syncTuyaRegistryForActor(req.user as any, req));
  } catch (error: any) {
    const message = error?.message || "Tuya sync failed";
    const status = message.includes("not linked") ? 409 : message.includes("estate context") ? 400 : 502;
    return res.status(status).json({ ok: false, provider: "tuya", error: message });
  }
});

export default router;
