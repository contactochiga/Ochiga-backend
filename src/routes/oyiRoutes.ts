import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { getOyiConversationMessages, getOyiUnifiedAwareness, listOyiConversationThreads } from "../services/oyiUnifiedIntelligenceService";
import { oyiCoreRuntime } from "../oyi-core/service";
import { executionLedger, type ExecutionLedgerScope } from "../oyi-core/runtime/executionLedger";
import { adaptCanonicalToCompatibilityChat, runCanonicalConversation } from "../oyi-core/runtime/canonicalConversationRuntime";
import { operationalMetrics } from "../observability/metrics";

const router = Router();

function observeCompatibilityRoute(route: string, surface: string | null | undefined) {
  operationalMetrics.increment("oyi_compatibility_route_calls_total", {
    route,
    surface: String(surface || "unknown"),
  });
}

function runtimeExecutionScope(req: any, defaultLimit: number): ExecutionLedgerScope {
  return {
    estateId: req.user?.role === "resident" ? undefined : req.oisContext?.estate_id || req.user?.estate_id || null,
    homeId: req.user?.role === "resident" ? req.oisContext?.home_id || req.user?.home_id || null : null,
    deviceId: req.query.deviceId ? String(req.query.deviceId) : null,
    provider: req.query.provider ? String(req.query.provider) : null,
    origin: req.query.origin ? String(req.query.origin) : null,
    action: req.query.action ? String(req.query.action) : null,
    initiatorId: req.query.initiatorId ? String(req.query.initiatorId) : null,
    status: req.query.status ? String(req.query.status) : null,
    limit: req.query.limit ? Number(req.query.limit) : defaultLimit,
  };
}

// Canonical ownership note:
// - /oyi/runtime/* is the backend-owned Oyi Core kernel surface.
// - /oyi/awareness and /oyi/chat are compatibility-only adapters.
// - Compatibility routes should prefer src/oyi-core for safe read-only
//   responses while preserving legacy payload shapes for older clients.
router.get("/awareness", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    observeCompatibilityRoute("/oyi/awareness", req.oisContext?.surface);
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
    observeCompatibilityRoute("/oyi/chat", req.oisContext?.surface);
    const runtime = await runCanonicalConversation(req.user || null, req.oisContext || null, {
      ...(req.body || {}),
      message: String(req.body?.message || req.body?.prompt || "").trim(),
      surface: req.oisContext?.surface as any,
      estate_id: req.oisContext?.estate_id || null,
      home_id: req.oisContext?.home_id || null,
      module: req.oisContext?.module || (req.body || {}).module || null,
      context: { ...(req.body?.context || {}), ...(req.oisContext || {}) },
      target: req.oisContext?.target || null,
    });
    return res.json(adaptCanonicalToCompatibilityChat(runtime));
  } catch {
    return res.status(500).json({ ok: false, error: "Unable to run canonical Oyi conversation" });
  }
});

router.get("/threads", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    observeCompatibilityRoute("/oyi/threads", req.oisContext?.surface);
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
    const runtime = await runCanonicalConversation(req.user || null, req.oisContext || null, {
      ...(req.body || {}),
      message: String(req.body?.request?.query || req.body?.message || req.body?.prompt || "").trim(),
      surface: req.oisContext?.surface as any,
      estate_id: req.oisContext?.estate_id || null,
      home_id: req.oisContext?.home_id || null,
      module: req.oisContext?.module || (req.body || {}).module || null,
      thread_id: req.body?.thread_id || req.body?.request?.thread_id || null,
      context: { ...(req.body?.request?.context || {}), ...(req.body?.context || {}), ...(req.oisContext || {}) },
      target: req.oisContext?.target || null,
    });
    return res.json({ ok: true, response: runtime });
  } catch {
    return res.status(500).json({ ok: false, error: "Unable to run canonical Oyi runtime conversation" });
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

router.get("/runtime/executions/stats/summary", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const scope = runtimeExecutionScope(req, 200);
    const executions = await executionLedger.listPersisted(scope);
    return res.json({
      ok: true,
      statistics: executionLedger.summarize(executions),
      operators: executionLedger.groupBy(executions, "operator"),
      providers: executionLedger.groupBy(executions, "provider"),
      estates: executionLedger.groupBy(executions, "estate"),
      timeline: executionLedger.timeline(executions).slice(0, 50),
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load execution statistics" });
  }
});

router.get("/runtime/executions/timeline", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const executions = await executionLedger.listPersisted(runtimeExecutionScope(req, 100));
    return res.json({ ok: true, timeline: executionLedger.timeline(executions) });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load execution timeline" });
  }
});

router.get("/runtime/executions/history", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const executions = await executionLedger.listPersisted(runtimeExecutionScope(req, 100));
    return res.json({ ok: true, executions });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load execution history" });
  }
});

router.get("/runtime/executions/stats/operators", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const executions = await executionLedger.listPersisted(runtimeExecutionScope(req, 200));
    return res.json({ ok: true, operators: executionLedger.groupBy(executions, "operator") });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load operator statistics" });
  }
});

router.get("/runtime/executions/stats/providers", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const executions = await executionLedger.listPersisted(runtimeExecutionScope(req, 200));
    return res.json({ ok: true, providers: executionLedger.groupBy(executions, "provider") });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load provider statistics" });
  }
});

router.get("/runtime/executions/stats/automation", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const executions = await executionLedger.listPersisted(runtimeExecutionScope(req, 200));
    const statistics = executionLedger.summarize(executions);
    return res.json({
      ok: true,
      automation: {
        total: statistics.automationActions,
        successRate: statistics.successRate,
        approvalsRequired: statistics.approvalRequired,
        rollbacksExecuted: statistics.rollbacksExecuted,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load automation statistics" });
  }
});

router.get("/runtime/executions/:executionId", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const id = String(req.params.executionId || "");
    const local = executionLedger.get(id);
    if (local) return res.json({ ok: true, execution: local });
    const executions = await executionLedger.listPersisted(runtimeExecutionScope(req, 200));
    const found = executions.find((item) => item.executionId === id);
    if (!found) return res.status(404).json({ ok: false, error: "Execution not found" });
    return res.json({ ok: true, execution: found });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load execution details" });
  }
});

router.get("/runtime/executions", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const executions = await executionLedger.listPersisted(runtimeExecutionScope(req, 100));
    return res.json({ ok: true, executions });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load execution history" });
  }
});

export default router;
