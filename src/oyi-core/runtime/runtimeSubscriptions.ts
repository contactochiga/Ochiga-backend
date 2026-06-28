import type { NormalizedSignal } from "../contracts/operationalSignal";
import type { OperationalAwareness } from "./contextAwareness";
import type { OperationalInsight } from "./operationalReasoning";
import type { OperationalRecommendation } from "./operationalRecommendations";
import type { AutomationPlan } from "./safeAutomation";
import type { ConversationRequest, ConversationResponse } from "./conversation";
import type { ExecutiveBriefing } from "./executive";
import { operationalMetrics } from "../../observability/metrics";
import { runtimeHealthRegistry } from "../../observability/runtimeHealth";

export type RuntimeChannel =
  | "facility:signal"
  | "facility:awareness"
  | "facility:insight"
  | "facility:recommendation"
  | "facility:automation"
  | "consumer:signal"
  | "consumer:awareness"
  | "consumer:insight"
  | "consumer:recommendation"
  | "consumer:automation"
  | "office:awareness"
  | "office:insight"
  | "office:recommendation"
  | "office:automation"
  | "notification:event"
  | "activity:event"
  | "conversation:request"
  | "conversation:response"
  | "executive:briefing"
  | "future:digital-twin"
  | "future:conversation"
  | "future:executive";

export type RuntimePayloadKind = "signal" | "awareness" | "insight" | "recommendation" | "automation" | "conversation" | "executive";

export type RuntimeDeliveryPayload = {
  event?: string;
  payload?: Record<string, unknown>;
  signal?: NormalizedSignal;
  awareness?: OperationalAwareness;
  insights?: OperationalInsight[];
  recommendations?: OperationalRecommendation[];
  automationPlans?: AutomationPlan[];
  conversationRequest?: ConversationRequest;
  conversationResponse?: ConversationResponse;
  executiveBriefing?: ExecutiveBriefing;
  receipt?: Record<string, unknown>;
  source?: string;
};

export type RuntimeDelivery = {
  id: string;
  sequence: number;
  channel: RuntimeChannel;
  kind: RuntimePayloadKind;
  createdAt: string;
  payload: RuntimeDeliveryPayload;
};

export type RuntimeSubscriber = {
  id: string;
  channels: RuntimeChannel[];
  replay?: number;
  onEvent: (delivery: RuntimeDelivery) => void;
};

type PublishInput = {
  kind: RuntimePayloadKind;
  payload: RuntimeDeliveryPayload;
  channels: RuntimeChannel[];
  dedupeKey?: string;
  createdAt?: string;
};

type SubscriberState = {
  subscriber: RuntimeSubscriber;
  deliveries: Map<string, number>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function timeMs(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function dedupeIdentity(payload: RuntimeDeliveryPayload) {
  return lower(
    [
      payload.event,
      payload.signal?.id,
      payload.awareness?.id,
      (payload.insights || []).map((item) => item.id).join(","),
      payload.signal?.domain,
      payload.signal?.entity.id || payload.signal?.entity.name,
    ].join(":")
  );
}

export class RuntimeSubscriptionEngine {
  private sequence = 0;
  private registry = new Map<string, SubscriberState>();
  private history = new Map<RuntimeChannel, RuntimeDelivery[]>();

  constructor(private options: { replayBuffer?: number; dedupeWindowMs?: number } = {}) {}

  register(subscriber: RuntimeSubscriber) {
    if (this.registry.has(subscriber.id)) return () => this.unregister(subscriber.id);
    this.registry.set(subscriber.id, { subscriber, deliveries: new Map() });
    if ((subscriber.replay || 0) > 0) this.replay(subscriber.id, subscriber.replay || 0);
    return () => this.unregister(subscriber.id);
  }

  unregister(id: string) {
    this.registry.delete(id);
  }

  publish(input: PublishInput) {
    const createdAt = input.createdAt || new Date().toISOString();
    const dedupeKey = input.dedupeKey || dedupeIdentity(input.payload);
    for (const channel of input.channels) {
      const startedAt = Date.now();
      const delivery: RuntimeDelivery = {
        id: `${channel}:${this.sequence + 1}`,
        sequence: ++this.sequence,
        channel,
        kind: input.kind,
        createdAt,
        payload: input.payload,
      };
      this.store(channel, delivery);
      this.deliver(channel, delivery, dedupeKey);
      operationalMetrics.increment("oyi_runtime_subscription_deliveries_total", { channel, kind: input.kind });
      operationalMetrics.observe("oyi_runtime_stage_latency_ms", Math.max(0, Date.now() - startedAt), { stage: "subscription.dispatch", channel, kind: input.kind });
      runtimeHealthRegistry.markStage(`subscription.dispatch:${channel}`, Math.max(0, Date.now() - startedAt));
    }
  }

  publishSignal(payload: RuntimeDeliveryPayload) {
    this.publish({
      kind: "signal",
      payload,
      channels: ["facility:signal", "consumer:signal", "activity:event", "future:digital-twin", "future:conversation"],
      dedupeKey: payload.signal?.id,
    });
  }

  publishAwareness(payload: RuntimeDeliveryPayload) {
    this.publish({
      kind: "awareness",
      payload,
      channels: ["facility:awareness", "consumer:awareness", "office:awareness", "notification:event", "activity:event", "future:digital-twin", "future:conversation", "future:executive"],
      dedupeKey: payload.awareness?.id || payload.signal?.id,
    });
  }

  publishInsights(payload: RuntimeDeliveryPayload) {
    if (!payload.insights?.length) return;
    this.publish({
      kind: "insight",
      payload,
      channels: ["facility:insight", "consumer:insight", "office:insight", "notification:event", "activity:event", "future:digital-twin", "future:conversation", "future:executive"],
    });
  }

  publishRecommendations(payload: RuntimeDeliveryPayload) {
    if (!payload.recommendations?.length) return;
    this.publish({
      kind: "recommendation",
      payload,
      channels: ["facility:recommendation", "consumer:recommendation", "office:recommendation", "notification:event", "activity:event", "future:conversation", "future:executive"],
    });
  }

  publishAutomation(payload: RuntimeDeliveryPayload) {
    if (!payload.automationPlans?.length) return;
    this.publish({
      kind: "automation",
      payload,
      channels: ["facility:automation", "consumer:automation", "office:automation", "activity:event", "future:conversation", "future:executive"],
    });
  }

  publishConversation(payload: RuntimeDeliveryPayload) {
    this.publish({
      kind: "conversation",
      payload,
      channels: ["conversation:request", "conversation:response", "future:conversation"],
    });
  }

  publishExecutive(payload: RuntimeDeliveryPayload) {
    this.publish({
      kind: "executive",
      payload,
      channels: ["executive:briefing", "future:executive"],
    });
  }

  private store(channel: RuntimeChannel, delivery: RuntimeDelivery) {
    const buffer = this.options.replayBuffer ?? 40;
    const current = this.history.get(channel) || [];
    this.history.set(channel, [delivery, ...current].slice(0, buffer));
  }

  private deliver(channel: RuntimeChannel, delivery: RuntimeDelivery, dedupeKey: string) {
    const windowMs = this.options.dedupeWindowMs ?? 1000 * 60 * 10;
    const now = timeMs(delivery.createdAt);
    for (const state of this.registry.values()) {
      if (!state.subscriber.channels.includes(channel)) continue;
      for (const [key, seenAt] of state.deliveries.entries()) {
        if (now - seenAt > windowMs) state.deliveries.delete(key);
      }
      if (state.deliveries.has(dedupeKey)) continue;
      state.deliveries.set(dedupeKey, now);
      state.subscriber.onEvent(delivery);
    }
  }

  private replay(id: string, count: number) {
    const state = this.registry.get(id);
    if (!state) return;
    const channels = state.subscriber.channels;
    const replay = channels.flatMap((channel) => this.history.get(channel) || []).sort((a, b) => b.sequence - a.sequence).slice(0, count).reverse();
    for (const delivery of replay) state.subscriber.onEvent(delivery);
  }
}

export const runtimeSubscriptionEngine = new RuntimeSubscriptionEngine();
