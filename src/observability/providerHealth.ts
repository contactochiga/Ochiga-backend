export type ProviderName =
  | "tuya"
  | "onvif"
  | "mqtt"
  | "matter"
  | "ble"
  | "thread"
  | "zigbee"
  | "modbus"
  | "bacnet"
  | "knx"
  | "ir";

export type ProviderHealthState = {
  provider: ProviderName;
  status: "online" | "offline" | "degraded" | "unknown";
  latencyMs: number | null;
  failures: number;
  reconnects: number;
  lastEventAt: string | null;
  lastError: string | null;
  healthScore: number;
};

const DEFAULT_PROVIDERS: ProviderName[] = ["tuya", "onvif", "mqtt", "matter", "ble", "thread", "zigbee", "modbus", "bacnet", "knx", "ir"];

class ProviderHealthRegistry {
  private state = new Map<ProviderName, ProviderHealthState>(
    DEFAULT_PROVIDERS.map((provider) => [
      provider,
      {
        provider,
        status: "unknown",
        latencyMs: null,
        failures: 0,
        reconnects: 0,
        lastEventAt: null,
        lastError: null,
        healthScore: 50,
      },
    ])
  );

  update(provider: ProviderName, patch: Partial<ProviderHealthState>) {
    const current = this.state.get(provider)!;
    const next = { ...current, ...patch };
    next.healthScore = this.score(next);
    this.state.set(provider, next);
    return next;
  }

  heartbeat(provider: ProviderName, patch: Partial<ProviderHealthState> = {}) {
    return this.update(provider, {
      status: patch.status || "online",
      latencyMs: patch.latencyMs ?? this.state.get(provider)?.latencyMs ?? null,
      lastEventAt: patch.lastEventAt || new Date().toISOString(),
      lastError: patch.lastError ?? null,
    });
  }

  failure(provider: ProviderName, error?: unknown) {
    const current = this.state.get(provider)!;
    return this.update(provider, {
      status: "degraded",
      failures: current.failures + 1,
      lastEventAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error || "provider_failure"),
    });
  }

  reconnect(provider: ProviderName) {
    const current = this.state.get(provider)!;
    return this.update(provider, {
      status: "online",
      reconnects: current.reconnects + 1,
      lastEventAt: new Date().toISOString(),
      lastError: null,
    });
  }

  snapshot() {
    return DEFAULT_PROVIDERS.map((provider) => this.state.get(provider)!);
  }

  private score(state: ProviderHealthState) {
    let score = state.status === "online" ? 100 : state.status === "degraded" ? 65 : state.status === "offline" ? 25 : 50;
    score -= Math.min(40, state.failures * 5);
    score -= state.latencyMs ? Math.min(25, Math.floor(state.latencyMs / 100)) : 0;
    if (state.reconnects > 0) score -= Math.min(10, state.reconnects);
    return Math.max(0, Math.min(100, score));
  }
}

export const providerHealthRegistry = new ProviderHealthRegistry();
