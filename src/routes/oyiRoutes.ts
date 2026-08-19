import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveRequestContext } from "../middleware/contextResolver";
import { getOyiConversationMessages, getOyiUnifiedAwareness, listOyiConversationThreads } from "../services/oyiUnifiedIntelligenceService";
import { oyiCoreRuntime } from "../oyi-core/service";
import { executionLedger, type ExecutionLedgerScope } from "../oyi-core/runtime/executionLedger";
import { adaptCanonicalToCompatibilityChat } from "../oyi-core/runtime/canonicalConversationAdapters";
import { conversationOrchestrator } from "../oyi-core/orchestration/ConversationOrchestrator";
import { mapOyiRouteBodyToConversationRequest } from "../oyi-core/api/ConversationRequestMapper";
import { operationalMetrics } from "../observability/metrics";
import { normalizeIntelligenceContextEnvelope } from "../oyi-core/contracts/intelligenceContextEnvelope";
import { canonicalIntelligenceStore } from "../oyi-core/persistence/canonicalIntelligenceStore";
import { getDeviceCommandExecution } from "../services/deviceCommandExecutionStore";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { deviceRuntimeStateService } from "../services/deviceRuntimeStateService";
import { classifyFreshness } from "../oyi-core/contracts/freshness";
import { observationPolicyForDevice } from "../oyi-core/domains/devices/deviceObservationPolicy";
import { capabilityRegistry } from "../oyi-core/capabilities/CapabilityRegistry";
import { buildDeviceActionCapabilities } from "../oyi-core/capabilities/DeviceActionCapabilityModules";
import { buildPhaseBReadCapabilities } from "../oyi-core/capabilities/ReadCapabilityModules";
import { recordOyiObservabilityEvent, observabilityStatusFromTruthState } from "../intelligence-core/oyiObservabilityBridge";
import { randomUUID } from "crypto";

const router = Router();
let capabilityIntrospectionRegistered = false;

function ensureCapabilityIntrospectionRegistered() {
  if (capabilityIntrospectionRegistered) return;
  for (const capability of buildPhaseBReadCapabilities()) capabilityRegistry.register(capability);
  for (const capability of buildDeviceActionCapabilities()) capabilityRegistry.register(capability);
  capabilityIntrospectionRegistered = true;
}

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
    const runtime = await conversationOrchestrator.run({
      actor: req.user || null,
      oisContext: req.oisContext || null,
      input: mapOyiRouteBodyToConversationRequest(req.body || {}, req.oisContext || null, "chat"),
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
  const requestId = randomUUID();
  const startedAt = Date.now();
  const surface = req.oisContext?.surface;
  try {
    const runtime = await conversationOrchestrator.run({
      actor: req.user || null,
      oisContext: req.oisContext || null,
      input: mapOyiRouteBodyToConversationRequest(req.body || {}, req.oisContext || null, "runtime"),
    });
    // Only consumer/facility real conversation events are observable here
    // (office_internal/public_corporate already handled at their own
    // routes) — never blocks or alters the response above.
    if (surface === "consumer" || surface === "facility") {
      void recordOyiObservabilityEvent({
        surface,
        mode: "text",
        category: "conversation",
        event_type: "conversation.turn_completed",
        status: observabilityStatusFromTruthState(runtime?.truth?.truth_state),
        actor_ref: req.user?.id || null,
        estate_id: runtime?.context?.estate_id || null,
        home_id: runtime?.context?.home_id || null,
        capability: runtime?.capability_key || null,
        conversation_id: runtime?.thread_id || null,
        request_id: requestId,
        latency_ms: Date.now() - startedAt,
        safe_summary: `Conversation turn (${runtime?.intent || "general"})`,
        source_table: "oyi_conversation_messages",
        source_event_id: runtime?.id || requestId,
      });
    }
    return res.json({ ok: true, response: runtime });
  } catch {
    if (surface === "consumer" || surface === "facility") {
      void recordOyiObservabilityEvent({
        surface,
        mode: "text",
        category: "conversation",
        event_type: "conversation.turn_completed",
        status: "failed",
        actor_ref: req.user?.id || null,
        request_id: requestId,
        latency_ms: Date.now() - startedAt,
        safe_summary: "Conversation turn failed",
        source_table: "oyi_conversation_messages",
        source_event_id: requestId,
      });
    }
    return res.status(500).json({ ok: false, error: "Unable to run canonical Oyi runtime conversation" });
  }
});

router.get("/runtime/internal/capabilities", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    if (!Array.isArray(req.user?.permissions) || !req.user.permissions.includes("system.admin")) {
      return res.status(403).json({ ok: false, error: "Permission denied" });
    }
    ensureCapabilityIntrospectionRegistered();
    const domain = req.query.domain ? String(req.query.domain) : "";
    const surface = req.query.surface ? String(req.query.surface) : "";
    const rolloutStatus = req.query.rollout_status ? String(req.query.rollout_status) : "";
    const capabilities = capabilityRegistry.all()
      .filter((capability) => !domain || capability.domain === domain)
      .filter((capability) => !rolloutStatus || capability.rolloutStatus === rolloutStatus)
      .filter((capability) => !surface || !capability.supported_surfaces?.length || capability.supported_surfaces.includes(surface as any))
      .map((capability) => ({
        key: capability.key,
        domain: capability.domain,
        rollout_status: capability.rolloutStatus,
        supported_surfaces: capability.supported_surfaces || [],
        operations: capability.operations || [],
        risk_class: capability.risk_class || "read",
        confirmation_policy: capability.confirmation_policy || "none",
        handler_availability: {
          resolver: typeof capability.resolve === "function",
          evidence_loader: typeof capability.collectEvidence === "function",
          read_handler: typeof capability.buildReadResponse === "function",
          draft_handler: typeof capability.createDraft === "function",
          execute_handler: typeof capability.execute === "function",
          verify_handler: typeof capability.verify === "function",
        },
        evidence_requirement_count: capability.evidence_requirements?.length || 0,
        presentation_policy: capability.presentation_policy || null,
      }));
    return res.json({ ok: true, count: capabilities.length, capabilities });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to inspect Oyi capabilities" });
  }
});

router.get("/runtime/internal/device-runtime-audit", requireAuth, resolveRequestContext, async (req, res) => {
  try {
    if (!Array.isArray(req.user?.permissions) || !req.user.permissions.includes("system.admin")) {
      return res.status(403).json({ ok: false, error: "Permission denied" });
    }
    const homeId = req.query.homeId ? String(req.query.homeId) : req.oisContext?.home_id || null;
    let query = supabaseAdmin.from("devices").select("*").limit(5_000);
    if (homeId) query = query.eq("home_id", homeId);
    const { data, error } = await query;
    if (error) throw error;
    const devices = data || [];
    const rows = devices.map((device: any) => {
      const runtime = deviceRuntimeStateService.get(String(device.id || ""));
      const policy = observationPolicyForDevice(device, runtime as any);
      const observedAt = String(runtime?.provider_timestamp || runtime?.runtime_timestamp || runtime?.last_refresh || "") || null;
      const conversationFreshness = classifyFreshness(policy, observedAt);
      const physical = !device.is_virtual && !device.parent_device_id;
      const runtimeEligible = Boolean(device.id && (device.provider || device.adapter || device.vendor || device.is_virtual));
      const schedulerEligible = runtimeEligible && policy.mode !== "unobservable" && policy.mode !== "disabled";
      return {
        device_id: device.id,
        name: device.name || device.label || device.display_name || "Unnamed smart device",
        home_id: device.home_id || null,
        room_id: device.room_id || null,
        physical_or_virtual: physical ? "physical" : device.is_virtual ? "virtual" : "child_or_derived",
        provider: device.provider || device.vendor || null,
        adapter: device.adapter || null,
        external_id_present: Boolean(device.external_id || device.provider_device_id || device.tuya_device_id),
        registered: Boolean(device.id),
        runtime_eligible: runtimeEligible,
        scheduler_eligible: schedulerEligible,
        refresh_class: runtime?.refresh_class || policy.mode,
        last_refresh_attempt: null,
        last_successful_refresh: runtime?.last_successful_refresh || null,
        provider_observation_timestamp: runtime?.provider_timestamp || null,
        persisted_snapshot_timestamp: runtime?.runtime_timestamp || null,
        conversation_freshness: conversationFreshness,
        exclusion_reason: runtimeEligible ? null : "missing_provider_or_adapter",
        suppression_reason: runtime?.provider_warning || runtime?.provider_error?.classification || null,
        parent_device: device.parent_device_id || null,
      };
    });
    const totals = rows.reduce((acc: Record<string, number>, row: any) => {
      acc.registry_count += 1;
      if (row.physical_or_virtual === "physical") acc.physical_count += 1;
      if (row.physical_or_virtual === "virtual") acc.virtual_count += 1;
      if (row.runtime_eligible) acc.runtime_eligible_count += 1;
      if (row.scheduler_eligible) acc.scheduler_eligible_count += 1;
      if (deviceRuntimeStateService.has(String(row.device_id))) acc.cached_count += 1;
      acc[`${row.conversation_freshness}_count`] = (acc[`${row.conversation_freshness}_count`] || 0) + 1;
      return acc;
    }, {
      registry_count: 0,
      physical_count: 0,
      virtual_count: 0,
      runtime_eligible_count: 0,
      scheduler_eligible_count: 0,
      cached_count: 0,
      fresh_count: 0,
      stale_count: 0,
      expired_count: 0,
      unknown_count: 0,
      unobservable_count: 0,
      provider_disconnected_count: 0,
    });
    return res.json({ ok: true, totals, devices: rows });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Unable to load device runtime audit" });
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
