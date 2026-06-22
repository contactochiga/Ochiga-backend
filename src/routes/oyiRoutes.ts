import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { getOyiConversationMessages, getOyiUnifiedAwareness, listOyiConversationThreads, runOyiUnifiedChat } from "../services/oyiUnifiedIntelligenceService";

const router = Router();

router.get("/awareness", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const body = await getOyiUnifiedAwareness(req.user || null, {
      surface: req.oisContext?.surface as any,
      estate_id: req.oisContext?.estate_id || null,
      home_id: req.oisContext?.home_id || null,
      context: req.oisContext,
    });
    return res.status((body as any).ok === false ? 400 : 200).json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to build Oyi awareness" });
  }
});

router.post("/chat", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const body = await runOyiUnifiedChat(req.user || null, {
      ...(req.body || {}),
      surface: req.oisContext?.surface as any,
      estate_id: req.oisContext?.estate_id || null,
      home_id: req.oisContext?.home_id || null,
      module: req.oisContext?.module || (req.body || {}).module || null,
      context: req.oisContext,
    });
    return res.status((body as any).ok === false ? 400 : 200).json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to run Oyi chat" });
  }
});

router.get("/threads", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const body = await listOyiConversationThreads(req.user || null, {
      surface: req.oisContext?.surface as any,
      estate_id: req.oisContext?.estate_id || null,
      home_id: req.oisContext?.home_id || null,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    return res.status((body as any).ok === false ? 400 : 200).json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load Oyi threads" });
  }
});

router.get("/threads/:threadId/messages", requireAuth, async (req, res) => {
  try {
    const body = await getOyiConversationMessages(req.user || null, String(req.params.threadId || ""));
    return res.status((body as any).ok === false ? 404 : 200).json(body);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load Oyi thread messages" });
  }
});

export default router;
