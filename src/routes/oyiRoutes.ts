import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { getOyiConversationMessages, getOyiUnifiedAwareness, listOyiConversationThreads } from "../services/oyiUnifiedIntelligenceService";
import { oyiCoreRuntime } from "../oyi-core/service";
import { executionLedger, type ExecutionLedgerScope } from "../oyi-core/runtime/executionLedger";
import { adaptCanonicalToCompatibilityChat, runCanonicalConversation } from "../oyi-core/runtime/canonicalConversationRuntime";
import { operationalMetrics } from "../observability/metrics";
import { normalizeIntelligenceContextEnvelope } from "../oyi-core/contracts/intelligenceContextEnvelope";
import { canonicalIntelligenceStore } from "../oyi-core/persistence/canonicalIntelligenceStore";
import { getDeviceCommandExecution } from "../services/deviceCommandExecutionStore";

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
      target: req.body?.target || req.body?.request?.target || req.oisContext?.target || null,
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

router.post("/runtime/context", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const context = normalizeIntelligenceContextEnvelope({ ...(req.body?.context || {}), ...(req.oisContext || {}) }, (req.user || {}) as unknown as Record<string, unknown>);
    return res.json({ ok: true, context });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to normalize Oyi runtime context" });
  }
});

router.post("/runtime/feedback", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    const objectType = String(req.body?.object_type || "").trim();
    const objectId = String(req.body?.object_id || "").trim();
    const feedbackType = String(req.body?.feedback_type || "").trim();
    if (!objectType || !objectId || !feedbackType) return res.status(422).json({ ok: false, error: "object_type, object_id and feedback_type are required" });
    await canonicalIntelligenceStore.recordFeedback({
      objectType,
      objectId,
      feedbackType,
      actorId: req.user?.id || null,
      reason: req.body?.reason ? String(req.body.reason) : null,
      outcome: req.body?.outcome && typeof req.body.outcome === "object" ? req.body.outcome : {},
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to record Oyi feedback" });
  }
});

router.post("/runtime/outbox/process", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    if (!Array.isArray(req.user?.permissions) || !req.user.permissions.includes("system.admin")) {
      return res.status(403).json({ ok: false, error: "Permission denied" });
    }
    const result = await canonicalIntelligenceStore.processDeliveryOutbox(req.body?.limit ? Number(req.body.limit) : 25);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to process Oyi delivery outbox" });
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
      target: req.body?.target || req.body?.request?.target || req.oisContext?.target || null,
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
    const commandExecution = await getDeviceCommandExecution(id).catch(() => null);
    if (commandExecution?.command_execution_id) {
      const actorId = String((commandExecution as any).actor_id || "");
      const homeId = String((commandExecution as any).home_id || "");
      const estateId = String((commandExecution as any).estate_id || "");
      const isResident = String(req.user?.role || "").toLowerCase() === "resident";
      if (isResident && req.user?.id && actorId && actorId !== String(req.user.id)) return res.status(403).json({ ok: false, error: "Execution is outside your scope" });
      if (req.oisContext?.home_id && homeId && homeId !== String(req.oisContext.home_id)) return res.status(403).json({ ok: false, error: "Execution is outside active home" });
      if (req.oisContext?.estate_id && estateId && estateId !== String(req.oisContext.estate_id)) return res.status(403).json({ ok: false, error: "Execution is outside active building" });
      return res.json({ ok: true, execution: commandExecution });
    }
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
