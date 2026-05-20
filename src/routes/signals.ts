// src/routes/signals.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { ingestSignal } from "../controllers/signal.controller";

const router = Router();

// ✅ Canonical: POST /signals
router.post("/", requireAuth, requirePermission("devices.control"), (req, res) => ingestSignal(req, res));

/**
 * ✅ Convenience alias:
 * POST /signals/device/:deviceId/command
 * Forwards into ingestSignal as a normal signal
 */
router.post("/device/:deviceId/command", requireAuth, requirePermission("devices.control"), (req, res) => {
  req.body = {
    ...req.body,
    deviceId: req.params.deviceId,
    type: req.body?.type ?? "device.command.requested",
  };

  return ingestSignal(req, res);
});

export default router;
