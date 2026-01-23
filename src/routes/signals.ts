import { Router, type RequestHandler } from "express";
import { requireAuth as _requireAuth } from "../middleware/auth";
import { ingestSignal } from "../controllers/signal.controller";

const router = Router();

// ✅ Fix TS overload issues: force Express middleware typing
const requireAuth = _requireAuth as unknown as RequestHandler;

// ✅ Original (keep)
router.post("/", requireAuth, ingestSignal);

/**
 * ✅ Convenience alias:
 * POST /signals/device/:deviceId/command
 * Forwards into ingestSignal as a normal signal
 */
router.post("/device/:deviceId/command", requireAuth, async (req, res) => {
  req.body = {
    ...req.body,
    deviceId: req.params.deviceId,
    // normalize key variants just in case
    device_id: req.body?.device_id ?? req.params.deviceId,
    // IMPORTANT: your contracts use device.command.requested
    // so default to that (but still allow override)
    type: req.body?.type ?? "device.command.requested",
  };

  // ✅ ingestSignal takes ONLY (req,res)
  return ingestSignal(req, res);
});

export default router;
