import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { ingestSignal } from "../controllers/signal.controller";

const router = Router();

// ✅ Original (keep)
router.post("/", requireAuth, ingestSignal);

/**
 * ✅ Convenience alias:
 * POST /signals/device/:deviceId/command
 * Forwards into ingestSignal as a normal signal
 */
router.post("/device/:deviceId/command", requireAuth, (req, res, next) => {
  req.body = {
    ...req.body,
    deviceId: req.params.deviceId,
    // normalize key variants just in case
    device_id: req.body?.device_id ?? req.params.deviceId,
    type: req.body?.type ?? "device.command",
  };

  return ingestSignal(req as any, res as any, next as any);
});

export default router;
