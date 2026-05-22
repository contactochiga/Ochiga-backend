import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  cancelWatchCommand,
  confirmWatchCommand,
  getWatchGlances,
  getWatchHomeStatus,
  getWatchQuickActions,
  runWatchCommand,
} from "../services/watchAdapterService";

const router = Router();

router.use(requireAuth);

router.get("/home-status", async (req, res) => {
  res.json(await getWatchHomeStatus(req.user!));
});

router.get("/glances", async (req, res) => {
  res.json(await getWatchGlances(req.user!));
});

router.get("/quick-actions", async (req, res) => {
  res.json(await getWatchQuickActions(req.user!));
});

router.post("/command", async (req, res) => {
  const payload = await runWatchCommand(req, req.user!, {
    command: req.body?.command,
    action_id: req.body?.action_id,
  });
  res.json(payload);
});

router.post("/confirm", async (req, res) => {
  const ledgerId = String(req.body?.ledger_id || req.body?.ledgerId || "").trim();
  if (!ledgerId) return res.status(400).json({ error: "ledger_id is required" });
  res.json(await confirmWatchCommand(req.user!, ledgerId));
});

router.post("/cancel", async (req, res) => {
  const ledgerId = String(req.body?.ledger_id || req.body?.ledgerId || "").trim();
  if (!ledgerId) return res.status(400).json({ error: "ledger_id is required" });
  res.json(await cancelWatchCommand(req.user!, ledgerId));
});

export default router;
