import type { ProviderName } from "./providerHealth";
import { providerHealthRegistry } from "./providerHealth";

type StageHealth = {
  stage: string;
  count: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  lastSeenAt: string | null;
};

class RuntimeHealthRegistry {
  private stages = new Map<string, { count: number; totalLatencyMs: number; lastLatencyMs: number | null; lastSeenAt: string | null }>();
  private socket = { connectedClients: 0, lastEventAt: null as string | null };
  private queue = { status: "unknown", lastCheckedAt: null as string | null, detail: "" };
  private database = { status: "unknown", lastCheckedAt: null as string | null, detail: "" };

  markStage(stage: string, latencyMs: number) {
    const current = this.stages.get(stage) || { count: 0, totalLatencyMs: 0, lastLatencyMs: null, lastSeenAt: null };
    const next = {
      count: current.count + 1,
      totalLatencyMs: current.totalLatencyMs + latencyMs,
      lastLatencyMs: latencyMs,
      lastSeenAt: new Date().toISOString(),
    };
    this.stages.set(stage, next);
    return next;
  }

  markSocketConnected(count: number) {
    this.socket = { connectedClients: count, lastEventAt: new Date().toISOString() };
  }

  markQueue(status: "healthy" | "degraded" | "offline" | "unknown", detail = "") {
    this.queue = { status, detail, lastCheckedAt: new Date().toISOString() };
  }

  markDatabase(status: "healthy" | "degraded" | "offline" | "unknown", detail = "") {
    this.database = { status, detail, lastCheckedAt: new Date().toISOString() };
  }

  providerSnapshot() {
    return providerHealthRegistry.snapshot();
  }

  stageSnapshot(): StageHealth[] {
    return [...this.stages.entries()].map(([stage, value]) => ({
      stage,
      count: value.count,
      lastLatencyMs: value.lastLatencyMs,
      avgLatencyMs: value.count ? Math.round(value.totalLatencyMs / value.count) : null,
      lastSeenAt: value.lastSeenAt,
    }));
  }

  summary() {
    return {
      runtime: this.stageSnapshot(),
      socket: this.socket,
      queue: this.queue,
      database: this.database,
      providers: this.providerSnapshot(),
    };
  }
}

export const runtimeHealthRegistry = new RuntimeHealthRegistry();

export function markProviderOffline(provider: ProviderName, detail = "") {
  return providerHealthRegistry.update(provider, {
    status: "offline",
    lastError: detail || null,
    lastEventAt: new Date().toISOString(),
  });
}
