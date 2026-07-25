// src/routes/signals.ts
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { ingestSignal } from "../controllers/signal.controller";
import { resolveRequestContext } from "../middleware/contextResolver";
import { requestDeviceCommand } from "../controllers/deviceCommandController";

const router = Router();

// ✅ Canonical: POST /signals
router.post("/", requireAuth, resolveRequestContext, requirePermission("devices.control"), (req, res) => ingestSignal(req, res));

/**
 * ✅ Convenience alias:
 * POST /signals/device/:deviceId/command
 * Delegates into the canonical device command runtime.
 */
router.post("/device/:deviceId/command", requireAuth, resolveRequestContext, requirePermission("devices.control"), (req, res) => {
  const normalizedCommand =
    req.body?.command ??
    (req.body?.capability ? { [String(req.body.capability)]: req.body?.value } : undefined);
  req.body = {
    ...req.body,
    command: normalizedCommand,
    source: req.body?.source || "consumer-ui",
  };

  return requestDeviceCommand(req, res);
});

export default router;
