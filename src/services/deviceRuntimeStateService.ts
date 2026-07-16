import { adapterRegistry } from "../device/adapters/registry";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import {
  diffEnrichedDeviceState,
  enrichDeviceProviderState,
  summarizeDeviceFrontendContract,
} from "../device/runtime/deviceStateEnrichment";
import { getIO } from "../realtime/io";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { logger } from "../observability/logger";
import { operationalMetrics } from "../observability/metrics";

export type DeviceRuntimeFreshness = "fresh" | "stale" | "expired";
export type DeviceRuntimeRefreshPriority = "normal" | "high";

export type DeviceRuntimeSnapshot = {
  device_id: string;
  state: Record<string, any>;
  summary: ReturnType<typeof summarizeDeviceFrontendContract>;
  provider_timestamp: string | null;
  runtime_timestamp: string;
  last_refresh: string;
  ttl: number;
  stale: boolean;
  freshness: DeviceRuntimeFreshness;
  age_ms: number;
  provider_latency_ms: number | null;
  dirty: boolean;
  source: "runtime" | "persistent_snapshot";
};

type RuntimeEntry = Omit<DeviceRuntimeSnapshot, "stale" | "freshness" | "age_ms"> & {
  device: Record<string, any>;
  accessed_at_ms: number;
};

type DeviceRuntimeStateDependencies = {
  now?: () => number;
  resolveDevice?: (deviceId: string) => Promise<Record<string, any> | null>;
  loadSnapshots?: (deviceIds: string[]) => Promise<Array<Record<string, any>>>;
  readProviderState?: (device: Record<string, any>) => Promise<Record<string, any>>;
  persistSnapshot?: (entry: RuntimeEntry) => Promise<void>;
  broadcast?: (entry: RuntimeEntry, payload: Record<string, any>) => void;
  emitSignal?: (input: Record<string, any>) => Promise<void>;
};

type RefreshJob<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export class DeviceRuntimeRefreshQueue {
  private readonly waiting: Array<RefreshJob<any>> = [];
  private active = 0;
  private peak = 0;

  constructor(private readonly concurrency = 5) {}

  enqueue<T>(run: () => Promise<T>, priority: DeviceRuntimeRefreshPriority = "normal") {
    return new Promise<T>((resolve, reject) => {
      const job: RefreshJob<T> = { run, resolve, reject };
      if (priority === "high") this.waiting.unshift(job);
      else this.waiting.push(job);
      this.drain();
    });
  }

  stats() {
    return { active: this.active, queued: this.waiting.length, peak: this.peak, concurrency: this.concurrency };
  }

  private drain() {
    while (this.active < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      void job.run()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const FRESH_TTL_MS = 10_000;
const EXPIRED_AFTER_MS = 60_000;
const ACTIVE_WINDOW_MS = 60_000;
const MAX_CACHE_ENTRIES = 50_000;
const DEFAULT_DEVICE_SELECT = "id,name,estate_id,home_id,room_id,parent_device_id,is_virtual,category,type,external_id,provider,vendor,adapter,online,status,capabilities,metadata,last_seen_at,updated_at";

function validTimestamp(value: unknown) {
  const text = String(value || "").trim();
  return text && !Number.isNaN(new Date(text).getTime()) ? text : null;
}

function providerTimestamp(state: Record<string, any>) {
  return validTimestamp(
    state?._oyi_timeline?.provider_reported_at ||
    state?.provider_timestamp ||
    state?.provider_reported_at ||
    state?.reported_at ||
    state?.event_time,
  );
}

function runtimeTimestampFromRow(row: Record<string, any>) {
  return validTimestamp(
    row?.status?._oyi_runtime?.runtime_timestamp ||
    row?.status?._oyi_runtime?.last_refresh ||
    row?.updated_at ||
    row?.last_seen,
  );
}

function adapterName(device: Record<string, any>) {
  return String(device?.adapter || device?.provider || device?.vendor || "tuya").toLowerCase().trim();
}

function commandConfirmation(state: Record<string, any>, pending: Record<string, any> | null) {
  const command = pending?.command && typeof pending.command === "object" ? pending.command : null;
  if (!command) return { confirmed: false, comparable: false };
  const normalized = state?.normalized_state && typeof state.normalized_state === "object" ? state.normalized_state : {};
  const switches = normalized?.switches && typeof normalized.switches === "object" ? normalized.switches : {};
  let comparable = 0;
  let matched = 0;
  for (const [code, expected] of Object.entries(command)) {
    if (code === "type" || expected == null || typeof expected === "object") continue;
    const actual = state[code] ?? switches[code] ?? (["switch", "power", "on"].includes(code) ? normalized.power : undefined);
    if (actual === undefined) continue;
    comparable += 1;
    if (String(actual) === String(expected)) matched += 1;
  }
  return { confirmed: comparable > 0 && matched === comparable, comparable: comparable > 0 };
}

async function defaultResolveDevice(deviceId: string) {
  const { data, error } = await supabaseAdmin
    .from("devices")
    .select(DEFAULT_DEVICE_SELECT)
    .eq("id", deviceId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function defaultLoadSnapshots(deviceIds: string[]) {
  if (!deviceIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from("device_states")
    .select("device_id,status,last_seen,updated_at")
    .in("device_id", deviceIds);
  if (error) throw error;
  return data || [];
}

async function defaultReadProviderState(device: Record<string, any>) {
  let providerDevice = device;
  if (device?.is_virtual && device?.parent_device_id) {
    const parent = await defaultResolveDevice(String(device.parent_device_id));
    if (!parent?.id) throw new Error("Virtual device parent is unavailable");
    providerDevice = {
      ...parent,
      name: device.name,
      room_id: device.room_id || parent.room_id,
      home_id: device.home_id || parent.home_id,
      metadata: { ...(parent.metadata || {}), ...(device.metadata || {}) },
    };
  }
  initAdaptersOnce();
  const name = adapterName(providerDevice);
  const adapter = adapterRegistry.get(name) as any;
  if (!adapter || typeof adapter.getLiveState !== "function") {
    throw new Error(`Adapter ${name} does not support live state`);
  }
  const externalId = String(providerDevice?.external_id || "").trim();
  if (!externalId) throw new Error("Device has no provider identifier");
  return adapter.getLiveState(externalId);
}

async function defaultPersistSnapshot(entry: RuntimeEntry) {
  const { error } = await supabaseAdmin.from("device_states").upsert(
    {
      device_id: entry.device_id,
      status: entry.state,
      last_seen: entry.last_refresh,
    },
    { onConflict: "device_id" },
  );
  if (error) throw error;
}

function defaultBroadcast(entry: RuntimeEntry, payload: Record<string, any>) {
  const io = getIO();
  if (!io) return;
  let target = io.to(`device:${entry.device_id}`);
  if (entry.device?.estate_id) target = target.to(`estate:${entry.device.estate_id}`);
  if (entry.device?.home_id) target = target.to(`home:${entry.device.home_id}`);
  if (entry.device?.room_id) target = target.to(`room:${entry.device.room_id}`);
  target.emit("device.state.updated", payload);
  target.emit("device.status.updated", payload);
  target.emit("device:update", payload);
}

export class DeviceRuntimeStateService {
  private readonly cache = new Map<string, RuntimeEntry>();
  private readonly hydrations = new Map<string, Promise<DeviceRuntimeSnapshot | null>>();
  private readonly refreshes = new Map<string, Promise<DeviceRuntimeSnapshot | null>>();
  private readonly queue: DeviceRuntimeRefreshQueue;
  private readonly now: () => number;
  private readonly resolveDeviceRecord: NonNullable<DeviceRuntimeStateDependencies["resolveDevice"]>;
  private readonly loadSnapshotRows: NonNullable<DeviceRuntimeStateDependencies["loadSnapshots"]>;
  private readonly readProvider: NonNullable<DeviceRuntimeStateDependencies["readProviderState"]>;
  private readonly persist: NonNullable<DeviceRuntimeStateDependencies["persistSnapshot"]>;
  private readonly broadcast: NonNullable<DeviceRuntimeStateDependencies["broadcast"]>;
  private readonly emitSignal: NonNullable<DeviceRuntimeStateDependencies["emitSignal"]>;
  private scheduler: NodeJS.Timeout | null = null;

  constructor(dependencies: DeviceRuntimeStateDependencies = {}, concurrency = 5) {
    this.now = dependencies.now || Date.now;
    this.resolveDeviceRecord = dependencies.resolveDevice || defaultResolveDevice;
    this.loadSnapshotRows = dependencies.loadSnapshots || defaultLoadSnapshots;
    this.readProvider = dependencies.readProviderState || defaultReadProviderState;
    this.persist = dependencies.persistSnapshot || defaultPersistSnapshot;
    this.broadcast = dependencies.broadcast || defaultBroadcast;
    this.emitSignal = dependencies.emitSignal || (async (input) => {
      const { emitOperationalDeviceSignal } = await import("./deviceOperationalSignalService");
      await emitOperationalDeviceSignal(input as any);
    });
    this.queue = new DeviceRuntimeRefreshQueue(concurrency);
  }

  start() {
    if (this.scheduler) return;
    this.scheduler = setInterval(() => this.refreshActiveEntries(), 5_000);
    this.scheduler.unref?.();
    logger.info("device_runtime_v2_started", { refresh_concurrency: this.queue.stats().concurrency });
  }

  stop() {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }

  get(deviceId: string) {
    const entry = this.cache.get(String(deviceId));
    if (!entry) return null;
    entry.accessed_at_ms = this.now();
    return this.snapshot(entry);
  }

  set(device: Record<string, any>, state: Record<string, any>, input: {
    providerTimestamp?: string | null;
    runtimeTimestamp?: string;
    lastRefresh?: string;
    providerLatencyMs?: number | null;
    dirty?: boolean;
    source?: RuntimeEntry["source"];
  } = {}) {
    const runtimeTimestamp = input.runtimeTimestamp || new Date(this.now()).toISOString();
    const lastRefresh = input.lastRefresh || runtimeTimestamp;
    const hasCompleteContract = Boolean(
      state?.normalized_state &&
      Array.isArray(state?.capability_codes) &&
      Array.isArray(state?.supported_controls) &&
      state?.control_profile &&
      !device?.is_virtual,
    );
    const enriched: Record<string, any> = hasCompleteContract ? state : enrichDeviceProviderState({
      state,
      metadata: device?.metadata || {},
      device,
      provider: String(device?.provider || device?.vendor || adapterName(device)),
      adapter: adapterName(device),
    });
    const stateWithRuntime = {
      ...enriched,
      _oyi_timeline: {
        ...(enriched?._oyi_timeline || {}),
        received_at: enriched?._oyi_timeline?.received_at || runtimeTimestamp,
        provider_reported_at: input.providerTimestamp ?? providerTimestamp(enriched),
      },
      _oyi_runtime: {
        provider_timestamp: input.providerTimestamp ?? providerTimestamp(enriched),
        runtime_timestamp: runtimeTimestamp,
        last_refresh: lastRefresh,
        ttl: FRESH_TTL_MS,
        provider_latency_ms: input.providerLatencyMs ?? null,
      },
    };
    const entry: RuntimeEntry = {
      device_id: String(device.id),
      device,
      state: stateWithRuntime,
      summary: summarizeDeviceFrontendContract(device, {
        status: stateWithRuntime,
        last_seen: lastRefresh,
        updated_at: runtimeTimestamp,
      }),
      provider_timestamp: input.providerTimestamp ?? providerTimestamp(enriched),
      runtime_timestamp: runtimeTimestamp,
      last_refresh: lastRefresh,
      ttl: FRESH_TTL_MS,
      provider_latency_ms: input.providerLatencyMs ?? null,
      dirty: Boolean(input.dirty),
      source: input.source || "runtime",
      accessed_at_ms: this.now(),
    };
    this.cache.set(entry.device_id, entry);
    this.trimCache();
    operationalMetrics.gauge("oyi_device_runtime_cache_entries", this.cache.size);
    return this.snapshot(entry);
  }

  async getOrHydrate(device: Record<string, any>) {
    const cached = this.get(String(device.id));
    if (cached) return cached;
    const deviceId = String(device.id);
    const pending = this.hydrations.get(deviceId);
    if (pending) return pending;
    const hydration = this.hydrateMany([device]).then(() => this.get(deviceId)).finally(() => {
      this.hydrations.delete(deviceId);
    });
    this.hydrations.set(deviceId, hydration);
    return hydration;
  }

  async hydrateMany(devices: Array<Record<string, any>>) {
    const missing = devices.filter((device) => device?.id && !this.cache.has(String(device.id)));
    if (!missing.length) return;
    const rows = await this.loadSnapshotRows(missing.map((device) => String(device.id)));
    const deviceMap = new Map(missing.map((device) => [String(device.id), device]));
    for (const row of rows) {
      const device = deviceMap.get(String(row?.device_id || ""));
      const timestamp = runtimeTimestampFromRow(row);
      if (!device || !timestamp || !row?.status || typeof row.status !== "object") continue;
      this.set(device, row.status, {
        providerTimestamp: providerTimestamp(row.status),
        runtimeTimestamp: timestamp,
        lastRefresh: validTimestamp(row?.status?._oyi_runtime?.last_refresh) || timestamp,
        providerLatencyMs: Number(row?.status?._oyi_runtime?.provider_latency_ms) || null,
        source: "persistent_snapshot",
      });
    }
  }

  async acceptProviderState(device: Record<string, any>, state: Record<string, any>, input: {
    providerTimestamp?: string | null;
    providerLatencyMs?: number | null;
    source?: string;
    providerEventId?: string | null;
    event?: Record<string, any> | null;
    emitSignal?: boolean;
  } = {}) {
    const currentEntry = this.cache.get(String(device.id)) || null;
    const incomingProviderTimestamp = input.providerTimestamp ?? providerTimestamp(state);
    if (
      currentEntry?.provider_timestamp &&
      incomingProviderTimestamp &&
      new Date(incomingProviderTimestamp).getTime() < new Date(currentEntry.provider_timestamp).getTime()
    ) {
      operationalMetrics.increment("oyi_device_runtime_out_of_order_updates_total", { adapter: adapterName(device) });
      logger.warn("device_runtime_out_of_order_update_ignored", {
        device_id: String(device.id),
        current_provider_timestamp: currentEntry.provider_timestamp,
        incoming_provider_timestamp: incomingProviderTimestamp,
      });
      return {
        snapshot: this.snapshot(currentEntry),
        previousState: currentEntry.state,
        change: diffEnrichedDeviceState(currentEntry.state, currentEntry.state),
        payload: null,
        ignored: true,
      };
    }
    const previousState = currentEntry?.state || null;
    const pendingCommand = previousState?._oyi_pending_command && typeof previousState._oyi_pending_command === "object"
      ? previousState._oyi_pending_command
      : null;
    this.set(device, state, {
      providerTimestamp: incomingProviderTimestamp,
      providerLatencyMs: input.providerLatencyMs,
      dirty: false,
      source: "runtime",
    });
    const entry = this.cache.get(String(device.id))!;
    const confirmation = commandConfirmation(entry.state, pendingCommand);
    const confirmationAttempts = Number(pendingCommand?.confirmation_attempts || 0) + 1;
    if (pendingCommand && confirmation.confirmed) {
      entry.state._oyi_command_confirmation = {
        command: pendingCommand.command,
        source: pendingCommand.source || null,
        provider_accepted_at: pendingCommand.provider_accepted_at || null,
        state_confirmed_at: entry.runtime_timestamp,
        confirmation: "confirmed",
      };
    } else if (pendingCommand && confirmationAttempts < 3) {
      entry.state._oyi_pending_command = {
        ...pendingCommand,
        confirmation_attempts: confirmationAttempts,
        last_checked_at: entry.runtime_timestamp,
      };
      entry.dirty = true;
    } else if (pendingCommand) {
      entry.state._oyi_command_confirmation = {
        command: pendingCommand.command,
        source: pendingCommand.source || null,
        provider_accepted_at: pendingCommand.provider_accepted_at || null,
        last_checked_at: entry.runtime_timestamp,
        confirmation: confirmation.comparable ? "not_observed" : "unavailable",
      };
    }
    try {
      await this.persist(entry);
    } catch (error) {
      operationalMetrics.increment("oyi_device_runtime_persistence_failures_total");
      logger.error("device_runtime_snapshot_persist_failed", { error, device_id: entry.device_id });
    }
    const change = diffEnrichedDeviceState(previousState || {}, entry.state);
    const payload = this.websocketPayload(entry, input.source || "provider", input.providerEventId, input.event);
    this.broadcast(entry, payload);
    operationalMetrics.increment("oyi_device_runtime_updates_total", { source: input.source || "provider" });

    if (pendingCommand && !confirmation.confirmed && confirmationAttempts < 3) {
      this.scheduleRefresh(entry.device, { priority: "high", reason: "command_confirmation", delayMs: 1_500 });
    }

    if (input.emitSignal !== false && (change.changed || confirmation.confirmed)) {
      void this.emitSignal({
        eventType: (confirmation.confirmed ? "device.command.executed" : change.event_type) as any,
        source: "provider_reported",
        provider: String(device?.provider || device?.vendor || adapterName(device)),
        adapter: adapterName(device),
        providerEventId: input.providerEventId || null,
        estateId: device?.estate_id || null,
        homeId: device?.home_id || null,
        roomId: device?.room_id || null,
        device: {
          id: String(device.id),
          name: String(device?.name || "Device"),
          type: String(device?.type || ""),
          category: String(device?.category || ""),
          external_id: device?.external_id || null,
          vendor: String(device?.vendor || ""),
          adapter: adapterName(device),
          provider: String(device?.provider || device?.vendor || adapterName(device)),
          metadata: device?.metadata || {},
        },
        previousState,
        newState: entry.state,
        occurredAt: entry.runtime_timestamp,
        telemetrySummary: {
          ...(entry.summary.telemetry_summary || {}),
          changed_keys: change.changed_keys,
          provider_latency_ms: entry.provider_latency_ms,
        },
        extraMetadata: {
          runtime_v2: true,
          state_event_type: change.event_type,
          command_confirmation: confirmation.confirmed ? "confirmed" : pendingCommand ? "pending" : null,
          primary_state: entry.summary.primary_state,
          health_status: entry.summary.health_status,
        },
      }).catch((error) => logger.error("device_runtime_signal_failed", { error, device_id: entry.device_id }));
    }
    return { snapshot: this.snapshot(entry), previousState, change, payload };
  }

  markDirty(deviceId: string) {
    const entry = this.cache.get(String(deviceId));
    if (entry) entry.dirty = true;
  }

  refresh(deviceOrId: Record<string, any> | string, priority: DeviceRuntimeRefreshPriority = "normal", reason = "requested") {
    const deviceId = typeof deviceOrId === "string" ? deviceOrId : String(deviceOrId?.id || "");
    if (!deviceId) return Promise.resolve(null);
    const existing = this.refreshes.get(deviceId);
    if (existing) return existing;
    const queued = this.queue.enqueue(async () => {
      const device = typeof deviceOrId === "string" ? await this.resolveDeviceRecord(deviceId) : deviceOrId;
      if (!device?.id) return null;
      const startedAt = this.now();
      try {
        const state = await this.readProvider(device);
        const latency = this.now() - startedAt;
        operationalMetrics.observe("oyi_device_runtime_provider_latency_ms", latency, { adapter: adapterName(device) });
        const accepted = await this.acceptProviderState(device, state, {
          providerLatencyMs: latency,
          providerTimestamp: providerTimestamp(state),
          source: reason,
        });
        logger.info("device_runtime_refresh_complete", {
          device_id: deviceId,
          adapter: adapterName(device),
          reason,
          latency_ms: latency,
        });
        return accepted.snapshot;
      } catch (error) {
        const entry = this.cache.get(deviceId);
        if (entry) entry.dirty = true;
        operationalMetrics.increment("oyi_device_runtime_refresh_failures_total", { adapter: adapterName(device) });
        logger.warn("device_runtime_refresh_failed", { error, device_id: deviceId, adapter: adapterName(device), reason });
        return entry ? this.snapshot(entry) : null;
      }
    }, priority).finally(() => {
      this.refreshes.delete(deviceId);
    });
    this.refreshes.set(deviceId, queued);
    operationalMetrics.increment("oyi_device_runtime_refresh_queued_total", { priority, reason });
    return queued;
  }

  refreshMany(devices: Array<Record<string, any> | string>, priority: DeviceRuntimeRefreshPriority = "normal", reason = "batch") {
    return Promise.allSettled(devices.map((device) => this.refresh(device, priority, reason)));
  }

  scheduleRefresh(device: Record<string, any>, input: { priority?: DeviceRuntimeRefreshPriority; reason?: string; delayMs?: number } = {}) {
    this.markDirty(String(device.id));
    const run = () => {
      void this.refresh(device, input.priority || "high", input.reason || "scheduled")
        .catch((error) => logger.warn("device_runtime_scheduled_refresh_failed", { error, device_id: device.id }));
    };
    const delayMs = Math.max(0, Number(input.delayMs || 0));
    if (delayMs) {
      const timer = setTimeout(run, delayMs);
      timer.unref?.();
    } else {
      run();
    }
  }

  shouldRefresh(snapshot: DeviceRuntimeSnapshot | null) {
    return !snapshot || snapshot.stale || snapshot.dirty;
  }

  stats() {
    return {
      cache_entries: this.cache.size,
      in_flight_refreshes: this.refreshes.size,
      in_flight_hydrations: this.hydrations.size,
      refresh_queue: this.queue.stats(),
    };
  }

  private snapshot(entry: RuntimeEntry): DeviceRuntimeSnapshot {
    const ageMs = Math.max(0, this.now() - new Date(entry.last_refresh).getTime());
    const freshness: DeviceRuntimeFreshness = ageMs <= FRESH_TTL_MS && !entry.dirty
      ? "fresh"
      : ageMs <= EXPIRED_AFTER_MS && !entry.dirty
        ? "stale"
        : "expired";
    return {
      device_id: entry.device_id,
      state: entry.state,
      summary: entry.summary,
      provider_timestamp: entry.provider_timestamp,
      runtime_timestamp: entry.runtime_timestamp,
      last_refresh: entry.last_refresh,
      ttl: entry.ttl,
      stale: freshness !== "fresh",
      freshness,
      age_ms: ageMs,
      provider_latency_ms: entry.provider_latency_ms,
      dirty: entry.dirty,
      source: entry.source,
    };
  }

  private websocketPayload(entry: RuntimeEntry, source: string, providerEventId?: string | null, event?: Record<string, any> | null) {
    const snapshot = this.snapshot(entry);
    return {
      deviceId: entry.device_id,
      device_id: entry.device_id,
      external_device_id: entry.device?.external_id || null,
      estate_id: entry.device?.estate_id || null,
      estateId: entry.device?.estate_id || null,
      home_id: entry.device?.home_id || null,
      homeId: entry.device?.home_id || null,
      room_id: entry.device?.room_id || null,
      roomId: entry.device?.room_id || null,
      state: entry.state,
      summary: entry.summary,
      normalized_state: entry.summary.normalized_state,
      primary_state: entry.summary.primary_state,
      health_status: entry.summary.health_status,
      provider_health: entry.summary.provider_health,
      provider_timestamp: snapshot.provider_timestamp,
      runtime_timestamp: snapshot.runtime_timestamp,
      last_refresh: snapshot.last_refresh,
      ttl: snapshot.ttl,
      stale: snapshot.stale,
      source,
      provider_event_id: providerEventId || null,
      occurred_at: snapshot.runtime_timestamp,
      event: event || null,
    };
  }

  private refreshActiveEntries() {
    const now = this.now();
    const candidates = Array.from(this.cache.values())
      .filter((entry) => entry.dirty || (now - entry.accessed_at_ms <= ACTIVE_WINDOW_MS && this.snapshot(entry).stale))
      .sort((a, b) => Number(b.dirty) - Number(a.dirty) || a.accessed_at_ms - b.accessed_at_ms)
      .slice(0, 25);
    for (const entry of candidates) {
      void this.refresh(entry.device, entry.dirty ? "high" : "normal", "background")
        .catch((error) => logger.warn("device_runtime_background_refresh_failed", { error, device_id: entry.device_id }));
    }
  }

  private trimCache() {
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
}

export const deviceRuntimeStateService = new DeviceRuntimeStateService();
