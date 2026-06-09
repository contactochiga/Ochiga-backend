import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { hasWatchScope } from "../services/watchPolicy";
import { supabaseAdmin } from "../supabase/supabaseClient";
import {
  cancelWatchCommand,
  confirmWatchCommand,
  getWatchFavorites,
  getWatchGlances,
  getWatchHomeStatus,
  getWatchQuickActions,
  getWatchScenes,
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

router.get("/favorites", requirePermission("devices.read"), async (req, res) => {
  res.json(await getWatchFavorites(req.user!));
});

router.get("/scenes", requirePermission("devices.read"), async (req, res) => {
  res.json(await getWatchScenes(req.user!));
});

router.get("/status", requirePermission("devices.read"), async (req, res) => {
  res.json(await getWatchStatus(req.user!));
});

router.get("/timeline-summary", requirePermission("devices.read"), async (req, res) => {
  const user: any = req.user || {};
  const homeId = user.home_id || null;
  const estateId = user.estate_id || null;
  let timelineQuery = supabaseAdmin
    .from("home_timeline")
    .select("id,title,summary,category,importance,occurred_at,metadata")
    .order("occurred_at", { ascending: false })
    .limit(12);
  if (homeId) timelineQuery = timelineQuery.eq("home_id", homeId);
  else if (estateId) timelineQuery = timelineQuery.eq("estate_id", estateId);
  else timelineQuery = timelineQuery.eq("user_id", user.id);
  const [{ data: timeline }, { data: counters }] = await Promise.all([
    timelineQuery,
    homeId
      ? supabaseAdmin
          .from("device_usage_counters")
          .select("device_id,offline_count,failure_count,stability_score,last_offline_at,last_online_at")
          .eq("home_id", homeId)
          .order("last_used_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] } as any),
  ]);
  const rows = Array.isArray(timeline) ? timeline : [];
  const attention = rows.filter((row: any) => ["attention", "critical"].includes(String(row?.importance || "").toLowerCase())).slice(0, 4);
  const deviceRows = Array.isArray(counters) ? counters : [];
  res.json({
    highlights: rows.slice(0, 5).map((row: any) => ({ title: row.title, summary: row.summary, category: row.category, occurred_at: row.occurred_at })),
    attention_items: attention.map((row: any) => ({ title: row.title, summary: row.summary, category: row.category, occurred_at: row.occurred_at })),
    device_health: {
      unstable_count: deviceRows.filter((row: any) => Number(row?.stability_score ?? 100) < 80 || Number(row?.failure_count || 0) > 0).length,
      recently_offline_count: deviceRows.filter((row: any) => row?.last_offline_at && (!row?.last_online_at || String(row.last_offline_at) > String(row.last_online_at))).length,
    },
    last_updated: new Date().toISOString(),
  });
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
