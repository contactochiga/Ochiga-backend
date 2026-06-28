import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

export type RuntimeStage =
  | "http.request"
  | "signal.receive"
  | "context.build"
  | "awareness.build"
  | "reasoning.build"
  | "recommendation.build"
  | "automation.build"
  | "conversation.build"
  | "executive.build"
  | "realtime.emit"
  | "subscription.dispatch";

export type RuntimeContextState = {
  requestId: string;
  correlationId: string;
  runtimeId: string;
  stage?: RuntimeStage;
  producer?: string | null;
  consumer?: string | null;
  estateId?: string | null;
  buildingId?: string | null;
  roomId?: string | null;
  deviceId?: string | null;
  actorId?: string | null;
  startedAt: number;
  timestamps: Partial<Record<RuntimeStage, string>>;
  latenciesMs: Partial<Record<RuntimeStage, number>>;
};

const storage = new AsyncLocalStorage<RuntimeContextState>();

function value(input?: string | null) {
  const text = String(input || "").trim();
  return text || null;
}

export function createRuntimeContext(seed: Partial<RuntimeContextState> = {}): RuntimeContextState {
  const requestId = value(seed.requestId) || randomUUID();
  const correlationId = value(seed.correlationId) || requestId;
  return {
    requestId,
    correlationId,
    runtimeId: value(seed.runtimeId) || randomUUID(),
    stage: seed.stage,
    producer: value(seed.producer),
    consumer: value(seed.consumer),
    estateId: value(seed.estateId),
    buildingId: value(seed.buildingId),
    roomId: value(seed.roomId),
    deviceId: value(seed.deviceId),
    actorId: value(seed.actorId),
    startedAt: seed.startedAt || Date.now(),
    timestamps: { ...(seed.timestamps || {}) },
    latenciesMs: { ...(seed.latenciesMs || {}) },
  };
}

export function withRuntimeContext<T>(context: Partial<RuntimeContextState>, run: () => T): T {
  const current = storage.getStore();
  const merged = createRuntimeContext({ ...(current || {}), ...context });
  return storage.run(merged, run);
}

export function getRuntimeContext() {
  return storage.getStore() || null;
}

export function patchRuntimeContext(patch: Partial<RuntimeContextState>) {
  const current = storage.getStore();
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    timestamps: { ...current.timestamps, ...(patch.timestamps || {}) },
    latenciesMs: { ...current.latenciesMs, ...(patch.latenciesMs || {}) },
  };
  storage.enterWith(next);
  return next;
}

export function markRuntimeStage(stage: RuntimeStage, startedAt?: number) {
  const current = storage.getStore();
  if (!current) return null;
  const now = Date.now();
  const began = startedAt || now;
  const next = patchRuntimeContext({
    stage,
    timestamps: { [stage]: new Date(now).toISOString() },
    latenciesMs: { [stage]: Math.max(0, now - began) },
  });
  return next;
}

export function runtimeTraceFields() {
  const current = storage.getStore();
  if (!current) return {};
  return {
    request_id: current.requestId,
    correlation_id: current.correlationId,
    runtime_id: current.runtimeId,
    runtime_stage: current.stage || null,
    runtime_started_at: new Date(current.startedAt).toISOString(),
    runtime_timestamps: current.timestamps,
    runtime_latencies_ms: current.latenciesMs,
    estate_id: current.estateId || null,
    building_id: current.buildingId || null,
    room_id: current.roomId || null,
    device_id: current.deviceId || null,
    actor_id: current.actorId || null,
    producer: current.producer || null,
    consumer: current.consumer || null,
  };
}
