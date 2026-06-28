import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { getOyiConversationMessages, getOyiUnifiedAwareness, listOyiConversationThreads, runOyiUnifiedChat } from "../services/oyiUnifiedIntelligenceService";
import { oyiCoreRuntime } from "../oyi-core/service";

const router = Router();

// Canonical ownership note:
// - /oyi/runtime/* is the backend-owned Oyi Core kernel surface.
// - /oyi/awareness and /oyi/chat are compatibility-only adapters.
// - Compatibility routes should prefer src/oyi-core for safe read-only
//   responses while preserving legacy payload shapes for older clients.
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

router.post("/runtime/evaluate", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const body = oyiCoreRuntime.evaluate({
      signals: Array.isArray(req.body?.signals) ? req.body.signals : [],
      context: req.body?.context || req.oisContext || undefined,
      permissions: Array.isArray(req.user?.permissions) ? req.user.permissions : [],
    });
    return res.json({ ok: true, ...body });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to evaluate Oyi runtime" });
  }
});

router.post("/runtime/conversation", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const response = oyiCoreRuntime.conversation(
      {
        id: String(req.body?.request?.id || `conversation:${Date.now()}`),
        query: String(req.body?.request?.query || ""),
        estateId: req.oisContext?.estate_id || null,
        buildingId: req.body?.request?.buildingId || null,
        unitId: req.body?.request?.unitId || null,
        actor: {
          id: req.user?.id || null,
          name: req.user?.username || null,
          role: req.user?.role || null,
          permissions: Array.isArray(req.user?.permissions) ? req.user.permissions : [],
        },
        context: req.body?.request?.context || req.oisContext || undefined,
        requestedDomain: req.body?.request?.requestedDomain || null,
      },
      {
        signals: Array.isArray(req.body?.signals) ? req.body.signals : [],
        context: req.body?.context || req.oisContext || undefined,
        permissions: Array.isArray(req.user?.permissions) ? req.user.permissions : [],
      }
    );
    return res.json({ ok: true, response });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to run Oyi runtime conversation" });
  }
});

router.post("/runtime/executive", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const briefing = oyiCoreRuntime.executive((req.body?.period || "daily") as any, {
      signals: Array.isArray(req.body?.signals) ? req.body.signals : [],
      context: req.body?.context || req.oisContext || undefined,
      permissions: Array.isArray(req.user?.permissions) ? req.user.permissions : [],
    });
    return res.json({ ok: true, briefing });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to build executive runtime briefing" });
  }
});

export default router;
