// src/routes/aiRoutes.ts
import { Router } from "express";
import { emitAuditEvent } from "../core/foundation";
import { requireAuth } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { listAiLedger, listAiConfirmations, updateAiConfirmation } from "../ai/commandRouter";
import { AI_TOOL_REGISTRY } from "../ai/toolRegistry";
import { recordIntelligenceMemory } from "../services/intelligenceMemoryService";
import { adaptCanonicalToAiChat } from "../oyi-core/runtime/canonicalConversationAdapters";
import { conversationOrchestrator } from "../oyi-core/orchestration/ConversationOrchestrator";
import { operationalMetrics } from "../observability/metrics";

const router = Router();

// Freeze ownership note:
// - /ai/* remains a consumer-facing assistant and tool-routing surface.
// - It may orchestrate UI-safe actions, but it is not the canonical Oyi Core runtime.
// - Operational awareness, reasoning, recommendations, automation, conversation,
//   and execution history remain backend-owned under /oyi/runtime/*.

router.post("/chat", requireAuth, resolveRequestContext, async (req, res) => {
  const message: string = (req.body?.message || req.body?.prompt || "").trim();
  const context = req.body?.context || {};

  if (!message) return res.status(400).json({ error: "message is required" });
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  operationalMetrics.increment("oyi_compatibility_route_calls_total", {
    route: "/ai/chat",
    surface: String(req.oisContext?.surface || context.surface || req.headers["x-ochiga-surface"] || "consumer"),
  });

  const runtime = await conversationOrchestrator.run({
    actor: req.user,
    oisContext: req.oisContext || null,
    input: {
      ...(req.body || {}),
      message,
      surface: (req.oisContext?.surface as any) || String(context.surface || req.headers["x-ochiga-surface"] || "consumer"),
      estate_id: req.oisContext?.estate_id || context.estateId || context.estate_id || req.user.estate_id || null,
      home_id: req.oisContext?.home_id || context.homeId || context.home_id || req.user.home_id || null,
      module: req.oisContext?.module || context.module || null,
      thread_id: req.body?.thread_id || context.thread_id || context.threadId || null,
      context: { ...(context || {}), ...(req.oisContext || {}) },
      target: req.body?.target || context.target || req.oisContext?.target || null,
    } as any,
  });

  void recordIntelligenceMemory(req.user, {
    prompt: message,
    responseMode: runtime.display_mode,
    reply: runtime.reply,
    results: [{ status: runtime.requiresConfirmation ? "pending_confirmation" : "processed", data: { cards: runtime.cards, sources: runtime.sources, suggested_actions: runtime.suggested_actions } }],
  });

  return res.json(adaptCanonicalToAiChat(runtime));
});

router.get("/tools", requireAuth, async (_req, res) => {
  res.json({ tools: AI_TOOL_REGISTRY });
});

router.get("/executions", requireAuth, async (req, res) => {
  const payload = await listAiLedger(req.user!, Number(req.query.limit || 100));
  res.json(payload);
});

router.get("/confirmations", requireAuth, async (req, res) => {
  const payload = await listAiConfirmations(req.user!, Number(req.query.limit || 50));
  res.json(payload);
});

router.post("/confirmations/:id/confirm", requireAuth, async (req, res) => {
  const result = await updateAiConfirmation(req.user!, req.params.id, "confirmed");
  await emitAuditEvent({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    action: "ai.command.confirmed",
    resourceType: "ai_command",
    resourceId: req.params.id,
    estateId: req.user!.estate_id,
    homeId: req.user!.home_id,
    status: result.ok ? "success" : "failed",
    metadata: { error: result.error || "", execution_status: result.record?.execution_status || "" },
    req,
  } as any);
  if (result.ok && result.record) {
    await emitAuditEvent({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: result.record.execution_status === "executed" ? "ai.tool.executed" : "ai.action.failed",
      resourceType: "ai_command",
      resourceId: req.params.id,
      estateId: req.user!.estate_id,
      homeId: req.user!.home_id,
      status: result.record.execution_status === "executed" ? "success" : "failed",
      metadata: {
        tool_id: result.record.tool_id,
        execution_status: result.record.execution_status,
        result_summary: result.record.result_summary || "",
        error: result.record.error_message || "",
      },
      req,
    } as any);
  }
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

router.post("/confirmations/:id/cancel", requireAuth, async (req, res) => {
  const result = await updateAiConfirmation(req.user!, req.params.id, "denied");
  await emitAuditEvent({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorRole: req.user!.role,
    action: "ai.command.cancelled",
    resourceType: "ai_command",
    resourceId: req.params.id,
    estateId: req.user!.estate_id,
    homeId: req.user!.home_id,
    status: result.ok ? "success" : "failed",
    metadata: { error: result.error || "" },
    req,
  } as any);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

export default router;
