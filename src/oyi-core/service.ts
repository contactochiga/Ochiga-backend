import { getIO } from "../realtime/io";
import { emitAuditEvent } from "../core/foundation";
import { universalSignalRuntime, type SignalRuntimeReceipt } from "./runtime/universalSignalRuntime";
import { buildAwareness, buildAwarenessFromSignal, type OperationalAwareness, type OperationalContext } from "./runtime/contextAwareness";
import { buildAutomationPlans, type AutomationPlan } from "./runtime/safeAutomation";
import { buildConversationResponse, type ConversationRequest, type ConversationResponse } from "./runtime/conversation";
import { buildExecutiveBriefing, type ExecutiveBriefing, type ExecutivePeriod } from "./runtime/executive";
import { buildOperationalRecommendations, type OperationalRecommendation } from "./runtime/operationalRecommendations";
import { operationalReasoningRuntime, type OperationalInsight } from "./runtime/operationalReasoning";
import { runtimeSubscriptionEngine } from "./runtime/runtimeSubscriptions";
import { executionLedger, type ExecutionLedgerRecord } from "./runtime/executionLedger";
import { normalizeSignal, type NormalizedSignal } from "./contracts/operationalSignal";
import { logger } from "../observability/logger";
import { operationalMetrics } from "../observability/metrics";
import { createRuntimeContext, getRuntimeContext, markRuntimeStage, patchRuntimeContext, runtimeTraceFields, withRuntimeContext, type RuntimeStage } from "../observability/runtimeContext";
import { runtimeHealthRegistry } from "../observability/runtimeHealth";

export type RuntimeBundle = {
  signals: NormalizedSignal[];
  awareness: OperationalAwareness[];
  insights: OperationalInsight[];
  recommendations: OperationalRecommendation[];
  automationPlans: AutomationPlan[];
};

export type RuntimeEnvelope = {
  receipt: SignalRuntimeReceipt;
  bundle: RuntimeBundle;
  execution_record?: ExecutionLedgerRecord;
  operational_signal: NormalizedSignal;
  operational_awareness: OperationalAwareness;
  operational_insights: OperationalInsight[];
  operational_recommendations: OperationalRecommendation[];
  operational_automation_plans: AutomationPlan[];
};

export type RuntimeEvaluationInput = {
  signals?: Array<Partial<NormalizedSignal> & Record<string, unknown>>;
  context?: OperationalContext;
  permissions?: string[];
};

type RuntimeHooks = {
  persistSignal?: (signal: NormalizedSignal, receipt: SignalRuntimeReceipt) => Promise<void> | void;
  persistBundle?: (bundle: RuntimeBundle, scopeKey: string) => Promise<void> | void;
  audit?: (receipt: SignalRuntimeReceipt) => Promise<void> | void;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function scopeKey(signal?: NormalizedSignal | null) {
  return text(signal?.estate.id || signal?.building.id || signal?.room.id || "global");
}

function traceForSignal(signal?: Partial<NormalizedSignal> & Record<string, unknown>) {
  return {
    estateId: text(signal?.estate?.id || signal?.estate_id || signal?.estateId) || null,
    buildingId: text(signal?.building?.id || signal?.building_id || signal?.buildingId) || null,
    roomId: text(signal?.room?.id || signal?.room_id || signal?.roomId) || null,
    deviceId: text(signal?.entity?.id || signal?.entity_id || signal?.deviceId || signal?.device_id) || null,
    actorId: text(signal?.actor?.id || signal?.actor_id || signal?.actorId) || null,
  };
}

function observeStage(stage: RuntimeStage, startedAt: number, labels: Record<string, string> = {}) {
  const latencyMs = Math.max(0, Date.now() - startedAt);
  markRuntimeStage(stage, startedAt);
  runtimeHealthRegistry.markStage(stage, latencyMs);
  operationalMetrics.observe("oyi_runtime_stage_latency_ms", latencyMs, { stage, ...labels });
  return latencyMs;
}

class OyiCoreRuntimeKernel {
  private recentSignals = new Map<string, NormalizedSignal[]>();
  private hooks: RuntimeHooks = {};

  configureHooks(hooks: RuntimeHooks) {
    this.hooks = hooks;
  }

  evaluate(input: RuntimeEvaluationInput): RuntimeBundle {
    const active = getRuntimeContext();
    const seedSignal = (input.signals || [])[0];
    const execute = () => {
      operationalMetrics.increment("oyi_runtime_evaluations_total");

      const normalizeStartedAt = Date.now();
      const signals = (input.signals || []).map((item) => normalizeSignal(item));
      if (signals[0]) patchRuntimeContext(traceForSignal(signals[0]));
      observeStage("signal.receive", normalizeStartedAt, { mode: "evaluate" });

      const awarenessStartedAt = Date.now();
      const awareness = buildAwareness(signals, input.context);
      operationalMetrics.increment("oyi_awareness_generated_total", {}, awareness.length);
      observeStage("awareness.build", awarenessStartedAt, { mode: "evaluate" });

      const insightStartedAt = Date.now();
      const insights = operationalReasoningRuntime.evaluate({ signals, awareness, context: input.context, signalHistory: signals });
      operationalMetrics.increment("oyi_insights_generated_total", {}, insights.length);
      observeStage("reasoning.build", insightStartedAt, { mode: "evaluate" });

      const recommendationStartedAt = Date.now();
      const recommendations = buildOperationalRecommendations({ signals, awareness, insights, context: input.context });
      operationalMetrics.increment("oyi_recommendations_generated_total", {}, recommendations.length);
      observeStage("recommendation.build", recommendationStartedAt, { mode: "evaluate" });

      const automationStartedAt = Date.now();
      const automationPlans = buildAutomationPlans({ signals, awareness, insights, recommendations, context: input.context, permissions: input.permissions || [] });
      operationalMetrics.increment("oyi_automation_plans_generated_total", {}, automationPlans.length);
      observeStage("automation.build", automationStartedAt, { mode: "evaluate" });
      return { signals, awareness, insights, recommendations, automationPlans };
    };

    if (active) return execute();
    return withRuntimeContext(createRuntimeContext({ producer: "oyi_core_runtime", consumer: "evaluate", ...traceForSignal(seedSignal) }), execute);
  }

  async receiveSignal(input: Partial<NormalizedSignal> & Record<string, unknown>, options: { permissions?: string[] } = {}): Promise<RuntimeEnvelope> {
    const active = getRuntimeContext();
    const execute = async () => {
      operationalMetrics.increment("oyi_signals_received_total", { source: text(input.source || "unknown") || "unknown" });

      const receiptStartedAt = Date.now();
      const receipt = universalSignalRuntime.receive(input);
      let seedSignal: NormalizedSignal = {
        ...receipt.signal,
        metadata: {
          ...receipt.signal.metadata,
          runtime_trace: runtimeTraceFields(),
        },
      };
      const execution = executionLedger.startForSignal(seedSignal, receipt, receipt.receivedAt);
      seedSignal = {
        ...seedSignal,
        runtimeId: execution.runtimeId,
        metadata: {
          ...seedSignal.metadata,
          execution_id: execution.executionId,
          runtime_id: execution.runtimeId,
          correlation_id: execution.correlationId,
          provenance: {
            origin: seedSignal.origin,
            initiatorType: seedSignal.initiatorType,
            initiatorId: seedSignal.initiatorId,
            provider: seedSignal.provider,
            providerEventId: seedSignal.providerEventId,
            sessionId: seedSignal.sessionId,
            runtimeId: execution.runtimeId,
            correlationId: execution.correlationId,
            triggerReason: seedSignal.triggerReason,
            verified: seedSignal.verified,
            verificationMethod: seedSignal.verificationMethod,
            trustScore: seedSignal.trustScore,
            executionSource: seedSignal.executionSource,
          },
        },
        context: {
          ...seedSignal.context,
          executionId: execution.executionId,
          runtimeId: execution.runtimeId,
          correlationId: execution.correlationId,
        },
      };
      patchRuntimeContext(traceForSignal(seedSignal));
      observeStage("signal.receive", receiptStartedAt, { mode: "receive" });

      if (!receipt.accepted) {
        const duplicateAwareness: OperationalAwareness = {
          id: `awareness:${seedSignal.id}:deduplicated`,
          kind: "operational",
          title: receipt.duplicate ? "Duplicate signal ignored" : "Signal rejected",
          summary: receipt.duplicate ? "Oyi already processed this signal recently." : "Oyi rejected this signal before operational reasoning.",
          reason: receipt.duplicate ? "duplicate_signal" : "signal_validation_failed",
          impact: "No duplicate activity, notification, recommendation, automation, or reporting work was created.",
          urgency: "monitor",
          owner: "Oyi Core",
          recommended_action: "No action needed.",
          verification: "Runtime receipt",
          supporting_evidence: seedSignal.evidence,
          related_signals: [seedSignal.id],
          related_executions: [execution.executionId],
          executionReference: execution.executionId,
          confidence: 1,
          generated_at: receipt.receivedAt,
          context: {},
        };
        const bundle: RuntimeBundle = {
          signals: [seedSignal],
          awareness: [duplicateAwareness],
          insights: [],
          recommendations: [],
          automationPlans: [],
        };
        const envelope: RuntimeEnvelope = {
          receipt: { ...receipt, signal: seedSignal },
          bundle,
          execution_record: execution,
          operational_signal: seedSignal,
          operational_awareness: duplicateAwareness,
          operational_insights: [],
          operational_recommendations: [],
          operational_automation_plans: [],
        };
        const completedAt = new Date().toISOString();
        envelope.execution_record = executionLedger.complete(execution.executionId, {
          completedAt,
          duration: Math.max(0, new Date(completedAt).getTime() - new Date(execution.startedAt).getTime()),
          status: "failed",
          result: {
            accepted: false,
            duplicate: receipt.duplicate,
            outputs: receipt.outputs,
            issues: receipt.issues,
            priority: receipt.priority,
            summary: receipt.duplicate ? "Duplicate signal rejected before reasoning and side effects." : "Signal rejected before reasoning and side effects.",
          },
          evidence: seedSignal.evidence,
        }) || execution;
        operationalMetrics.increment("oyi_signal_duplicates_prevented_total", { duplicate: String(receipt.duplicate) });
        logger.info("oyi_runtime_signal_rejected_before_reasoning", {
          signal_id: seedSignal.id,
          domain: seedSignal.domain,
          duplicate: receipt.duplicate,
          accepted: false,
        });
        return envelope;
      }

      const key = scopeKey(seedSignal);
      const history = this.recentSignals.get(key) || [];
      const nextHistory = [seedSignal, ...history.filter((item) => item.id !== seedSignal.id)].slice(0, 80);
      this.recentSignals.set(key, nextHistory);

      const awarenessStartedAt = Date.now();
      const awareness = buildAwarenessFromSignal(seedSignal, { signalHistory: nextHistory });
      operationalMetrics.increment("oyi_awareness_generated_total");
      observeStage("awareness.build", awarenessStartedAt, { mode: "receive" });

      const insightStartedAt = Date.now();
      const insights = operationalReasoningRuntime.evaluate({
        signals: nextHistory,
        awareness: [awareness, ...buildAwareness(nextHistory)],
        signalHistory: nextHistory,
      });
      operationalMetrics.increment("oyi_insights_generated_total", {}, insights.length);
      observeStage("reasoning.build", insightStartedAt, { mode: "receive" });

      const recommendationStartedAt = Date.now();
      const recommendations = buildOperationalRecommendations({
        signals: nextHistory,
        awareness: [awareness],
        insights,
      });
      operationalMetrics.increment("oyi_recommendations_generated_total", {}, recommendations.length);
      observeStage("recommendation.build", recommendationStartedAt, { mode: "receive" });

      const automationStartedAt = Date.now();
      const automationPlans = buildAutomationPlans({
        signals: nextHistory,
        awareness: [awareness],
        insights,
        recommendations,
        permissions: options.permissions || [],
      });
      operationalMetrics.increment("oyi_automation_plans_generated_total", {}, automationPlans.length);
      observeStage("automation.build", automationStartedAt, { mode: "receive" });

      const bundle: RuntimeBundle = {
        signals: nextHistory,
        awareness: [awareness],
        insights,
        recommendations,
        automationPlans,
      };
      const envelope: RuntimeEnvelope = {
        receipt: { ...receipt, signal: seedSignal },
        bundle,
        execution_record: execution,
        operational_signal: seedSignal,
        operational_awareness: awareness,
        operational_insights: insights,
        operational_recommendations: recommendations,
        operational_automation_plans: automationPlans,
      };

      const publishStartedAt = Date.now();
      runtimeSubscriptionEngine.publishSignal({ signal: seedSignal, receipt: envelope.receipt, source: "oyi_core_runtime" });
      runtimeSubscriptionEngine.publishAwareness({ signal: seedSignal, awareness, receipt: envelope.receipt, source: "oyi_core_runtime" });
      runtimeSubscriptionEngine.publishInsights({ signal: seedSignal, insights, receipt: envelope.receipt, source: "oyi_core_runtime" });
      runtimeSubscriptionEngine.publishRecommendations({ signal: seedSignal, recommendations, receipt: envelope.receipt, source: "oyi_core_runtime" });
      runtimeSubscriptionEngine.publishAutomation({ signal: seedSignal, automationPlans, receipt: envelope.receipt, source: "oyi_core_runtime" });
      observeStage("subscription.dispatch", publishStartedAt, { mode: "receive" });

      const completedAt = new Date().toISOString();
      const completedExecution = executionLedger.complete(execution.executionId, {
        completedAt,
        duration: Math.max(0, new Date(completedAt).getTime() - new Date(execution.startedAt).getTime()),
        status: envelope.receipt.accepted ? "executed" : "failed",
        result: {
          accepted: envelope.receipt.accepted,
          duplicate: envelope.receipt.duplicate,
          outputs: envelope.receipt.outputs,
          issues: envelope.receipt.issues,
          priority: envelope.receipt.priority,
          summary: envelope.receipt.accepted
            ? `Signal processed through awareness, reasoning, recommendation, and automation runtimes.`
            : `Signal failed runtime acceptance checks.`,
        },
        evidence: seedSignal.evidence,
        reasoningReference: insights[0]?.id || null,
        recommendationReference: recommendations[0]?.id || null,
        automationReference: automationPlans[0]?.id || null,
      });
      envelope.execution_record = completedExecution || execution;

      await this.safeHook(() => this.hooks.persistSignal?.(seedSignal, envelope.receipt));
      await this.safeHook(() => this.hooks.persistBundle?.(bundle, key));
      await this.safeHook(async () => {
        await this.hooks.audit?.(envelope.receipt);
        if (envelope.receipt.accepted && (seedSignal.severity === "critical" || seedSignal.severity === "warning")) {
          await emitAuditEvent({
            actorId: seedSignal.actor.id || "oyi_core_runtime",
            actorRole: seedSignal.actor.role || "system",
            actorEmail: "",
            action: "oyi.runtime.signal.received",
            resourceType: "operational_signal",
            resourceId: seedSignal.id,
            estateId: seedSignal.estate.id || null,
            homeId: null,
            status: envelope.receipt.accepted ? "success" : "denied",
            metadata: {
              duplicate: envelope.receipt.duplicate,
              issues: envelope.receipt.issues,
              priority: envelope.receipt.priority,
              domain: seedSignal.domain,
              runtime_trace: runtimeTraceFields(),
            },
          } as any);
        }
      });

      logger.info("oyi_runtime_signal_processed", {
        signal_id: seedSignal.id,
        domain: seedSignal.domain,
        accepted: envelope.receipt.accepted,
        outputs: envelope.receipt.outputs,
      });
      return envelope;
    };

    if (active) return execute();
    return withRuntimeContext(createRuntimeContext({ producer: text(input.source || "signal"), consumer: "oyi_core_runtime", ...traceForSignal(input) }), execute);
  }

  conversation(request: ConversationRequest, input: RuntimeEvaluationInput): ConversationResponse {
    const execute = () => {
      operationalMetrics.increment("oyi_conversation_requests_total");
      const bundle = this.evaluate(input);
      const startedAt = Date.now();
      const response = buildConversationResponse({
        request,
        signals: bundle.signals,
        awareness: bundle.awareness,
        insights: bundle.insights,
        recommendations: bundle.recommendations,
        automationPlans: bundle.automationPlans,
        executions: executionLedger.findRelated(bundle.signals),
        permissions: request.actor?.permissions || input.permissions || [],
        context: request.context,
      });
      for (const executionId of response.relatedExecutions || []) {
        executionLedger.complete(executionId, { conversationReference: response.id });
      }
      observeStage("conversation.build", startedAt);
      runtimeSubscriptionEngine.publishConversation({
        event: "conversation.runtime",
        conversationRequest: request,
        conversationResponse: response,
        source: "conversation_runtime",
      });
      return response;
    };
    if (getRuntimeContext()) return execute();
    return withRuntimeContext(createRuntimeContext({ producer: "conversation_request", consumer: "oyi_core_runtime", estateId: text(request.estateId) || null, actorId: text(request.actor?.id) || null }), execute);
  }

  executive(period: ExecutivePeriod, input: RuntimeEvaluationInput): ExecutiveBriefing {
    const execute = () => {
      operationalMetrics.increment("oyi_executive_requests_total", { period });
      const bundle = this.evaluate(input);
      const conversation = buildConversationResponse({
        request: {
          id: `executive:${period}`,
          query: `Summarize the ${period} operational posture.`,
          requestedDomain: "executive",
        },
        signals: bundle.signals,
        awareness: bundle.awareness,
        insights: bundle.insights,
        recommendations: bundle.recommendations,
        automationPlans: bundle.automationPlans,
        executions: executionLedger.findRelated(bundle.signals),
      });
      const startedAt = Date.now();
      const briefing = buildExecutiveBriefing({
        period,
        signals: bundle.signals,
        awareness: bundle.awareness,
        insights: bundle.insights,
        recommendations: bundle.recommendations,
        automationPlans: bundle.automationPlans,
        conversationSummaries: [conversation],
        executions: executionLedger.findRelated(bundle.signals),
      });
      for (const executionId of briefing.supportingEvidence
        .map((item) => String(item.metadata?.executionId || item.id || ""))
        .filter((item) => item.startsWith("execution:"))
        .map((item) => item.replace(/^execution:/, ""))) {
        executionLedger.complete(executionId, { executiveReference: briefing.id });
      }
      observeStage("executive.build", startedAt, { period });
      runtimeSubscriptionEngine.publishExecutive({
        event: "executive.runtime",
        executiveBriefing: briefing,
        conversationResponse: conversation,
        source: "executive_runtime",
      });
      return briefing;
    };
    if (getRuntimeContext()) return execute();
    return withRuntimeContext(createRuntimeContext({ producer: "executive_request", consumer: "oyi_core_runtime" }), execute);
  }

  decorateRealtimePayload(event: string, payload: Record<string, unknown>, permissions: string[] = []) {
    const execute = () =>
      this.receiveSignal(
        {
          ...payload,
          source: text(payload.source) || event,
          domain: text(payload.domain) || event,
          metadata: { ...(payload.metadata as Record<string, unknown> | undefined), event },
        },
        { permissions }
      );
    if (getRuntimeContext()) return execute();
    return withRuntimeContext(createRuntimeContext({ producer: event, consumer: "realtime_payload", ...traceForSignal(payload as any) }), execute);
  }

  emitRealtime(event: string, payload: Record<string, unknown>, envelope: RuntimeEnvelope) {
    const startedAt = Date.now();
    const io = getIO();
    if (!io) return;
    const signal = envelope.operational_signal;
    const estateId = signal.estate.id || (payload.estate_id as string | undefined) || (payload.estateId as string | undefined);
    const roomId = signal.room.id || (payload.room_id as string | undefined) || (payload.roomId as string | undefined);
    const deviceId = signal.entity.id || (payload.device_id as string | undefined) || (payload.deviceId as string | undefined);
    const userId = signal.actor.id || ((payload.requestedBy as Record<string, unknown> | undefined)?.userId as string | undefined);
    const enriched = { ...payload, event, ...envelope };
    if (estateId) io.to(`estate:${estateId}`).emit("signal", enriched);
    if (roomId) io.to(`room:${roomId}`).emit("signal", enriched);
    if (userId) io.to(`user:${userId}`).emit("signal", enriched);
    if (deviceId) io.to(`device:${deviceId}`).emit("signal", enriched);
    if (estateId) io.to(`estate:${estateId}`).emit(event, enriched);
    if (roomId) io.to(`room:${roomId}`).emit(event, enriched);
    if (userId) io.to(`user:${userId}`).emit(event, enriched);
    if (deviceId) io.to(`device:${deviceId}`).emit(event, enriched);
    observeStage("realtime.emit", startedAt, { event });
  }

  private async safeHook(run: () => Promise<void> | void) {
    try {
      await run();
    } catch (error) {
      console.warn("[oyi-core-runtime] hook failed", error);
    }
  }
}

export const oyiCoreRuntime = new OyiCoreRuntimeKernel();
