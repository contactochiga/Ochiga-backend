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
import { normalizeSignal, type NormalizedSignal } from "./contracts/operationalSignal";

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

class OyiCoreRuntimeKernel {
  private recentSignals = new Map<string, NormalizedSignal[]>();
  private hooks: RuntimeHooks = {};

  configureHooks(hooks: RuntimeHooks) {
    this.hooks = hooks;
  }

  evaluate(input: RuntimeEvaluationInput): RuntimeBundle {
    const signals = (input.signals || []).map((item) => normalizeSignal(item));
    const awareness = buildAwareness(signals, input.context);
    const insights = operationalReasoningRuntime.evaluate({ signals, awareness, context: input.context, signalHistory: signals });
    const recommendations = buildOperationalRecommendations({ signals, awareness, insights, context: input.context });
    const automationPlans = buildAutomationPlans({ signals, awareness, insights, recommendations, context: input.context, permissions: input.permissions || [] });
    return { signals, awareness, insights, recommendations, automationPlans };
  }

  async receiveSignal(input: Partial<NormalizedSignal> & Record<string, unknown>, options: { permissions?: string[] } = {}): Promise<RuntimeEnvelope> {
    const receipt = universalSignalRuntime.receive(input);
    const seedSignal = receipt.signal;
    const key = scopeKey(seedSignal);
    const history = this.recentSignals.get(key) || [];
    const nextHistory = [seedSignal, ...history.filter((item) => item.id !== seedSignal.id)].slice(0, 80);
    this.recentSignals.set(key, nextHistory);

    const awareness = buildAwarenessFromSignal(seedSignal, { signalHistory: nextHistory });
    const insights = operationalReasoningRuntime.evaluate({
      signals: nextHistory,
      awareness: [awareness, ...buildAwareness(nextHistory)],
      signalHistory: nextHistory,
    });
    const recommendations = buildOperationalRecommendations({
      signals: nextHistory,
      awareness: [awareness],
      insights,
    });
    const automationPlans = buildAutomationPlans({
      signals: nextHistory,
      awareness: [awareness],
      insights,
      recommendations,
      permissions: options.permissions || [],
    });
    const bundle: RuntimeBundle = {
      signals: nextHistory,
      awareness: [awareness],
      insights,
      recommendations,
      automationPlans,
    };
    const envelope: RuntimeEnvelope = {
      receipt,
      bundle,
      operational_signal: receipt.signal,
      operational_awareness: awareness,
      operational_insights: insights,
      operational_recommendations: recommendations,
      operational_automation_plans: automationPlans,
    };

    runtimeSubscriptionEngine.publishSignal({ signal: receipt.signal, receipt, source: "oyi_core_runtime" });
    runtimeSubscriptionEngine.publishAwareness({ signal: receipt.signal, awareness, receipt, source: "oyi_core_runtime" });
    runtimeSubscriptionEngine.publishInsights({ signal: receipt.signal, insights, receipt, source: "oyi_core_runtime" });
    runtimeSubscriptionEngine.publishRecommendations({ signal: receipt.signal, recommendations, receipt, source: "oyi_core_runtime" });
    runtimeSubscriptionEngine.publishAutomation({ signal: receipt.signal, automationPlans, receipt, source: "oyi_core_runtime" });

    await this.safeHook(() => this.hooks.persistSignal?.(receipt.signal, receipt));
    await this.safeHook(() => this.hooks.persistBundle?.(bundle, key));
    await this.safeHook(async () => {
      await this.hooks.audit?.(receipt);
      if (receipt.accepted && (receipt.signal.severity === "critical" || receipt.signal.severity === "warning")) {
        await emitAuditEvent({
          actorId: receipt.signal.actor.id || "oyi_core_runtime",
          actorRole: receipt.signal.actor.role || "system",
          actorEmail: "",
          action: "oyi.runtime.signal.received",
          resourceType: "operational_signal",
          resourceId: receipt.signal.id,
          estateId: receipt.signal.estate.id || null,
          homeId: null,
          status: receipt.accepted ? "success" : "denied",
          metadata: { duplicate: receipt.duplicate, issues: receipt.issues, priority: receipt.priority, domain: receipt.signal.domain },
        } as any);
      }
    });

    return envelope;
  }

  conversation(request: ConversationRequest, input: RuntimeEvaluationInput): ConversationResponse {
    const bundle = this.evaluate(input);
    const response = buildConversationResponse({
      request,
      signals: bundle.signals,
      awareness: bundle.awareness,
      insights: bundle.insights,
      recommendations: bundle.recommendations,
      automationPlans: bundle.automationPlans,
      permissions: request.actor?.permissions || input.permissions || [],
      context: request.context,
    });
    runtimeSubscriptionEngine.publishConversation({
      event: "conversation.runtime",
      conversationRequest: request,
      conversationResponse: response,
      source: "conversation_runtime",
    });
    return response;
  }

  executive(period: ExecutivePeriod, input: RuntimeEvaluationInput): ExecutiveBriefing {
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
    });
    const briefing = buildExecutiveBriefing({
      period,
      signals: bundle.signals,
      awareness: bundle.awareness,
      insights: bundle.insights,
      recommendations: bundle.recommendations,
      automationPlans: bundle.automationPlans,
      conversationSummaries: [conversation],
    });
    runtimeSubscriptionEngine.publishExecutive({
      event: "executive.runtime",
      executiveBriefing: briefing,
      conversationResponse: conversation,
      source: "executive_runtime",
    });
    return briefing;
  }

  decorateRealtimePayload(event: string, payload: Record<string, unknown>, permissions: string[] = []) {
    return this.receiveSignal(
      {
        ...payload,
        source: text(payload.source) || event,
        domain: text(payload.domain) || event,
        metadata: { ...(payload.metadata as Record<string, unknown> | undefined), event },
      },
      { permissions }
    );
  }

  emitRealtime(event: string, payload: Record<string, unknown>, envelope: RuntimeEnvelope) {
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
