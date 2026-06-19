import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getOyiUnifiedAwareness, runOyiUnifiedChat } from "../services/oyiUnifiedIntelligenceService";

const router = Router();

router.get("/awareness", requireAuth, async (req, res) => {
  try {
    const body = await getOyiUnifiedAwareness(req.user || null, {
      surface: req.query.surface as any,
      estate_id: req.query.estate_id ? String(req.query.estate_id) : null,
      home_id: req.query.home_id ? String(req.query.home_id) : null,
    });
    return res.status((body as any).ok === false ? 400 : 200).json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to build Oyi awareness" });
  }
});

router.post("/chat", requireAuth, async (req, res) => {
  try {
    const body = await runOyiUnifiedChat(req.user || null, req.body || {});
    return res.status((body as any).ok === false ? 400 : 200).json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to run Oyi chat" });
  }
});

export default router;
