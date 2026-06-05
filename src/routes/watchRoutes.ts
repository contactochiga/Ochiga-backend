import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { hasWatchScope } from "../services/watchPolicy";
import {
  cancelWatchCommand,
  confirmWatchCommand,
  getWatchGlances,
  getWatchHomeStatus,
  getWatchQuickActions,
  getWatchStatus,
  runWatchCommand,
} from "../services/watchAdapterService";

const router = Router();

router.use(requireAuth);
router.use((req, res, next) => {
  if (!hasWatchScope(req.user!)) {
    return res.status(403).json({
      error: "A home or estate context is required for Oyi Watch.",
      code: "watch_scope_required",
    });
  }
  next();
});

router.get("/home-status", requirePermission("devices.read"), async (req, res) => {
  res.json(await getWatchHomeStatus(req.user!));
});

router.get("/glances", requirePermission("devices.read"), async (req, res) => {
  res.json(await getWatchGlances(req.user!));
});

router.get("/quick-actions", requirePermission("devices.read"), async (req, res) => {
  res.json(await getWatchQuickActions(req.user!));
});

router.get("/status", requirePermission("devices.read"), async (req, res) => {
  res.json(await getWatchStatus(req.user!));
});

router.post("/command", requirePermission("devices.control"), async (req, res) => {
  const payload = await runWatchCommand(req, req.user!, {
    command: req.body?.command,
    action_id: req.body?.action_id,
    device_id: req.body?.device_id,
    device_command: req.body?.device_command,
  });
  res.json(payload);
});

router.post("/confirm", requirePermission("devices.control"), async (req, res) => {
  const ledgerId = String(req.body?.ledger_id || req.body?.ledgerId || "").trim();
  if (!ledgerId) return res.status(400).json({ error: "ledger_id is required" });
  res.json(await confirmWatchCommand(req.user!, ledgerId));
});

router.post("/cancel", requirePermission("devices.control"), async (req, res) => {
  const ledgerId = String(req.body?.ledger_id || req.body?.ledgerId || "").trim();
  if (!ledgerId) return res.status(400).json({ error: "ledger_id is required" });
  res.json(await cancelWatchCommand(req.user!, ledgerId));
});

export default router;
