import { adapterRegistry } from "../device/adapters/registry";
import { createHash } from "crypto";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import {
  buildCanonicalDevicePresentation,
  diffEnrichedDeviceState,
  enrichDeviceProviderState,
  sanitizePublicCapabilityCodes,
  summarizeDeviceFrontendContract,
} from "../device/runtime/deviceStateEnrichment";
import { getIO } from "../realtime/io";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { logger } from "../observability/logger";
import { operationalMetrics } from "../observability/metrics";
import {
  classifyProviderError,
  type CanonicalProviderError,
  type ProviderAuthorizationState,
} from "../device/runtime/providerErrors";
import { upsertDeviceCommandExecution } from "./deviceCommandExecutionStore";

export type DeviceRuntimeFreshness = "fresh" | "stale" | "expired";
export type DeviceRuntimeContractFreshness = "fresh" | "ageing" | "expired" | "unavailable" | "provider_disconnected";
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
  provider_error: CanonicalProviderError | null;
  authorization_state: ProviderAuthorizationState;
  provider_warning: string | null;
  retry_after: string | null;
  last_successful_refresh: string | null;
  next_refresh_at?: string | null;
  refresh_class?: string | null;
  viewed_until_at?: string | null;
};

type RuntimeEntry = Omit<DeviceRuntimeSnapshot, "stale" | "freshness" | "age_ms" | "viewed_until_at"> & {
  device: Record<string, any>;
  accessed_at_ms: number;
  viewed_until_ms?: number;
  last_viewed_at_ms?: number;
  last_refresh_attempt_ms?: number;
  next_refresh_at_ms?: number;
  refresh_class?: "currently_viewed" | "recently_commanded" | "active_critical" | "active_normal" | "recently_active" | "inactive" | "offline" | "provider_disconnected";
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
const RECENT_WINDOW_MS = 10 * 60_000;
const SCHEDULER_TICK_MS = 15_000;
const ACTIVE_REFRESH_INTERVAL_MS = 30_000;
const RECENT_REFRESH_INTERVAL_MS = 2 * 60_000;
const INACTIVE_REFRESH_INTERVAL_MS = 10 * 60_000;
const PROVIDER_DISCONNECTED_REFRESH_INTERVAL_MS = 15 * 60_000;
const OFFLINE_REFRESH_INTERVAL_MS = 10 * 60_000;
const CRITICAL_REFRESH_INTERVAL_MS = 45_000;
const MAX_CACHE_ENTRIES = 50_000;
const AUTHORIZATION_BACKOFF_INITIAL_MS = 5 * 60_000;
const AUTHORIZATION_BACKOFF_MAX_MS = 60 * 60_000;
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

function runtimeMetadata(state: Record<string, any> | null | undefined) {
  return state?._oyi_runtime && typeof state._oyi_runtime === "object" ? state._oyi_runtime as Record<string, any> : {};
}

function providerErrorFromState(state: Record<string, any> | null | undefined): CanonicalProviderError | null {
  const error = runtimeMetadata(state).provider_error;
  return error && typeof error === "object" ? error as CanonicalProviderError : null;
}

function authorizationStateFromState(state: Record<string, any> | null | undefined): ProviderAuthorizationState {
  const value = String(runtimeMetadata(state).authorization_state || "unknown");
  return ["authorized", "authorization_required", "device_not_linked", "unknown"].includes(value)
    ? value as ProviderAuthorizationState
    : "unknown";
}

function deterministicJitterMs(deviceId: string, intervalMs: number) {
  if (!deviceId || intervalMs <= 0) return 0;
  const maxJitter = Math.min(30_000, Math.max(2_000, Math.floor(intervalMs * 0.15)));
  let hash = 0;
  for (let i = 0; i < deviceId.length; i += 1) {
    hash = ((hash << 5) - hash + deviceId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % maxJitter;
}

function leaseKeyHash(input: { deviceId: string; actorId?: string | null; homeId?: string | null; source?: string | null }) {
  return createHash("sha256")
    .update([input.actorId || "anonymous", input.homeId || "no-home", input.deviceId, input.source || "device_panel"].join(":"))
    .digest("hex")
    .slice(0, 16);
}

function integrationOwner(device: Record<string, any>) {
  return String(device?.metadata?.oyi?.integration_owner_user_id || device?.metadata?.context?.userId || "").trim() || null;
}

function integrationUid(device: Record<string, any>) {
  return String(device?.metadata?.context?.tuyaUid || device?.metadata?.raw?.uid || "").trim() || null;
}

function adapterName(device: Record<string, any>) {
  return String(device?.adapter || device?.provider || device?.vendor || "tuya").toLowerCase().trim();
}

function commandConfirmation(state: Record<string, any>, pending: Record<string, any> | null) {
  const command = pending?.command && typeof pending.command === "object" ? pending.command : null;
  if (!command) return { confirmed: false, comparable: false, observed_at: null, newer_than_dispatch: false };
  const observedAt = providerTimestamp(state) || runtimeMetadata(state).runtime_timestamp || null;
  const dispatchAt = validTimestamp(pending?.provider_accepted_at) || null;
  const newerThanDispatch = Boolean(!dispatchAt || !observedAt || new Date(observedAt).getTime() >= new Date(dispatchAt).getTime());
  if (!newerThanDispatch) return { confirmed: false, comparable: false, observed_at: observedAt, newer_than_dispatch: false };
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
  return { confirmed: comparable > 0 && matched === comparable, comparable: comparable > 0, observed_at: observedAt, newer_than_dispatch: newerThanDispatch };
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
    if (device?.metadata?.ir_appliance?.remote_id) {
      return enrichDeviceProviderState({
        state: {
          online: parent.online !== false,
          provider_virtual: true,
          parent_hub_online: parent.online !== false,
          remote_id: device.metadata.ir_appliance.remote_id,
        },
        metadata: { ...(parent.metadata || {}), ...(device.metadata || {}) },
        device,
        provider: String(parent?.provider || parent?.vendor || adapterName(parent)),
        adapter: adapterName(parent),
      });
    }
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
    this.scheduler = setInterval(() => this.refreshActiveEntries(), SCHEDULER_TICK_MS);
    this.scheduler.unref?.();
    logger.info("device_runtime_v2_started", {
      refresh_concurrency: this.queue.stats().concurrency,
      scheduler_tick_ms: SCHEDULER_TICK_MS,
      active_refresh_interval_ms: ACTIVE_REFRESH_INTERVAL_MS,
      recent_refresh_interval_ms: RECENT_REFRESH_INTERVAL_MS,
      inactive_refresh_interval_ms: INACTIVE_REFRESH_INTERVAL_MS,
    });
  }

  stop() {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
  }

  has(deviceId: string) {
    return this.cache.has(String(deviceId));
  }

  get(deviceId: string) {
    const entry = this.cache.get(String(deviceId));
    if (!entry) return null;
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
      capability_codes: sanitizePublicCapabilityCodes(Array.isArray(enriched.capability_codes) ? enriched.capability_codes : []),
      _oyi_timeline: {
        ...(enriched?._oyi_timeline || {}),
        received_at: enriched?._oyi_timeline?.received_at || runtimeTimestamp,
        provider_reported_at: input.providerTimestamp ?? providerTimestamp(enriched),
      },
      _oyi_runtime: {
        ...(enriched?._oyi_runtime || {}),
        provider_timestamp: input.providerTimestamp ?? providerTimestamp(enriched),
        runtime_timestamp: runtimeTimestamp,
        last_refresh: lastRefresh,
        ttl: FRESH_TTL_MS,
        provider_latency_ms: input.providerLatencyMs ?? null,
      },
    };
    const seededRefreshAttemptMs = input.source === "persistent_snapshot" ? this.now() : undefined;
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
      provider_error: providerErrorFromState(stateWithRuntime),
      authorization_state: authorizationStateFromState(stateWithRuntime),
      provider_warning: String(stateWithRuntime?._oyi_runtime?.provider_warning || "").trim() || null,
      retry_after: validTimestamp(stateWithRuntime?._oyi_runtime?.next_retry_at),
      last_successful_refresh: validTimestamp(stateWithRuntime?._oyi_runtime?.provider_last_success_at),
      accessed_at_ms: 0,
      viewed_until_ms: 0,
      last_viewed_at_ms: undefined,
      // Persisted snapshots may be old when a process starts. Seeding the
      // scheduler attempt time prevents a cold cache from making every device
      // provider-due on the first scheduler tick.
      last_refresh_attempt_ms: seededRefreshAttemptMs,
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
      if (device) this.hydrateSnapshot(device, row);
    }
  }

  hydrateSnapshot(device: Record<string, any>, row: Record<string, any> | null | undefined) {
    const timestamp = runtimeTimestampFromRow(row || {});
    if (!device?.id || !timestamp || !row?.status || typeof row.status !== "object") return null;
    return this.set(device, row.status, {
      providerTimestamp: providerTimestamp(row.status),
      runtimeTimestamp: timestamp,
      lastRefresh: validTimestamp(row?.status?._oyi_runtime?.last_refresh) || timestamp,
      providerLatencyMs: Number(row?.status?._oyi_runtime?.provider_latency_ms) || null,
      source: "persistent_snapshot",
    });
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
    const previousProviderError = providerErrorFromState(previousState);
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
    entry.state._oyi_runtime = {
      ...runtimeMetadata(entry.state),
      provider_error: null,
      authorization_state: "authorized",
      provider_warning: null,
      next_retry_at: null,
      provider_last_success_at: entry.runtime_timestamp,
      provider_attention_key: null,
      provider_attention_emitted_at: null,
    };
    entry.state.provider_health = entry.state?.normalized_state?.online === false ? "offline" : "healthy";
    entry.provider_error = null;
    entry.authorization_state = "authorized";
    entry.provider_warning = null;
    entry.retry_after = null;
    entry.last_successful_refresh = entry.runtime_timestamp;
    entry.summary = summarizeDeviceFrontendContract(device, {
      status: entry.state,
      last_seen: entry.last_refresh,
      updated_at: entry.runtime_timestamp,
    });
    const confirmation = commandConfirmation(entry.state, pendingCommand);
    if (pendingCommand) {
      logger.info("device_command_confirmation_evidence", {
        command_execution_id: pendingCommand.command_execution_id || null,
        device_id: String(device.id),
        channel_code: Object.keys(pendingCommand.command || {}).find((key) => /^switch_\d+$/i.test(key)) || null,
        expected: pendingCommand.command || null,
        observed: entry.state,
        observation_source: input.source || "provider",
        provider_timestamp: incomingProviderTimestamp || entry.provider_timestamp || null,
        runtime_timestamp: entry.runtime_timestamp,
        command_dispatch_timestamp: pendingCommand.provider_accepted_at || null,
        newer_than_dispatch: confirmation.newer_than_dispatch,
        freshness: this.snapshot(entry).freshness,
        confirmation_result: confirmation.confirmed ? "confirmed" : confirmation.comparable ? "mismatch" : "not_comparable",
        physical_effect_status: confirmation.confirmed ? "inferred" : "unknown",
      });
    }
    const confirmationAttempts = Number(pendingCommand?.confirmation_attempts || 0) + 1;
    if (pendingCommand && confirmation.confirmed) {
      entry.state._oyi_command_confirmation = {
        command: pendingCommand.command,
        source: pendingCommand.source || null,
        provider_accepted_at: pendingCommand.provider_accepted_at || null,
        command_execution_id: pendingCommand.command_execution_id || null,
        actor_id: pendingCommand.actor_id || null,
        actor_role: pendingCommand.actor_role || null,
        state_confirmed_at: entry.runtime_timestamp,
        confirmation: "confirmed",
      };
      delete entry.state._oyi_pending_command;
      void upsertDeviceCommandExecution({
        command_execution_id: pendingCommand.command_execution_id || "",
        actor_id: pendingCommand.actor_id || null,
        actor_role: pendingCommand.actor_role || null,
        estate_id: device?.estate_id || null,
        home_id: device?.home_id || null,
        room_id: device?.room_id || null,
        canonical_device_id: String(device.id),
        parent_device_id: device?.parent_device_id || null,
        target_type: Object.keys(pendingCommand.command || {}).some((key) => /^switch_\d+$/i.test(key)) ? "device_channel" : "device",
        channel_code: Object.keys(pendingCommand.command || {}).find((key) => /^switch_\d+$/i.test(key)) || null,
        provider: String(device?.provider || device?.vendor || adapterName(device)),
        provider_device_id: device?.external_id || null,
        normalized_command: pendingCommand.command || null,
        command_key: pendingCommand.command_key || null,
        source: pendingCommand.source || null,
        confirmation_completed_at: entry.runtime_timestamp,
        finalised_at: entry.runtime_timestamp,
        request_status: "accepted",
        dispatch_status: "dispatched",
        provider_status: "accepted",
        confirmation_status: "state_confirmed",
        physical_effect_status: "inferred",
        expected_state: pendingCommand.command || null,
        observed_state: entry.state,
        final_status: "state_confirmed",
        truth_state: "state_confirmed",
        lifecycle: [{ status: "state_confirmed", occurred_at: entry.runtime_timestamp, label: "Runtime V2 confirmed the requested state." }],
      });
    } else if (pendingCommand && confirmationAttempts < 3) {
      entry.state._oyi_pending_command = {
        ...pendingCommand,
        confirmation_attempts: confirmationAttempts,
        last_checked_at: entry.runtime_timestamp,
      };
      entry.dirty = true;
    } else if (pendingCommand) {
      const terminalConfirmation = confirmation.comparable ? "state_mismatch" : "confirmation_timed_out";
      entry.state._oyi_command_confirmation = {
        command: pendingCommand.command,
        source: pendingCommand.source || null,
        provider_accepted_at: pendingCommand.provider_accepted_at || null,
        command_execution_id: pendingCommand.command_execution_id || null,
        actor_id: pendingCommand.actor_id || null,
        actor_role: pendingCommand.actor_role || null,
        last_checked_at: entry.runtime_timestamp,
        confirmation: terminalConfirmation,
      };
      delete entry.state._oyi_pending_command;
      void upsertDeviceCommandExecution({
        command_execution_id: pendingCommand.command_execution_id || "",
        actor_id: pendingCommand.actor_id || null,
        actor_role: pendingCommand.actor_role || null,
        estate_id: device?.estate_id || null,
        home_id: device?.home_id || null,
        room_id: device?.room_id || null,
        canonical_device_id: String(device.id),
        parent_device_id: device?.parent_device_id || null,
        target_type: Object.keys(pendingCommand.command || {}).some((key) => /^switch_\d+$/i.test(key)) ? "device_channel" : "device",
        channel_code: Object.keys(pendingCommand.command || {}).find((key) => /^switch_\d+$/i.test(key)) || null,
        provider: String(device?.provider || device?.vendor || adapterName(device)),
        provider_device_id: device?.external_id || null,
        normalized_command: pendingCommand.command || null,
        command_key: pendingCommand.command_key || null,
        source: pendingCommand.source || null,
        confirmation_completed_at: entry.runtime_timestamp,
        finalised_at: entry.runtime_timestamp,
        request_status: "accepted",
        dispatch_status: "dispatched",
        provider_status: "accepted",
        confirmation_status: terminalConfirmation,
        physical_effect_status: confirmation.comparable ? "contradicted" : "unknown",
        expected_state: pendingCommand.command || null,
        observed_state: entry.state,
        final_status: terminalConfirmation,
        truth_state: terminalConfirmation,
        safe_error_message: confirmation.comparable
          ? "The provider accepted the command, but the latest device state did not match the requested value."
          : "Oyi could not confirm a fresh device state after the provider accepted the command.",
        retryable: true,
        lifecycle: [{ status: terminalConfirmation, occurred_at: entry.runtime_timestamp, label: "Runtime V2 could not confirm the requested state." }],
      });
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
      logger.info("device_command_priority_refresh_scheduled", {
        command_execution_id: pendingCommand.command_execution_id || null,
        device_id: entry.device_id,
        channel_code: Object.keys(pendingCommand.command || {}).find((key) => /^switch_\d+$/i.test(key)) || null,
        delay_ms: 900,
        attempt: confirmationAttempts + 1,
      });
      this.scheduleRefresh(entry.device, { priority: "high", reason: "command_confirmation", delayMs: 900 });
    }

    const authorizationRecovered = Boolean(previousProviderError && ["permission_denied", "device_not_linked", "integration_expired", "authentication_failed"].includes(previousProviderError.classification));
    if (input.emitSignal !== false && (change.changed || confirmation.confirmed || authorizationRecovered)) {
      void this.emitSignal({
        eventType: (confirmation.confirmed ? "device.command.executed" : authorizationRecovered ? "device.provider.sync" : change.event_type) as any,
        source: "provider_reported",
        provider: String(device?.provider || device?.vendor || adapterName(device)),
        adapter: adapterName(device),
        providerEventId: confirmation.confirmed && pendingCommand?.command_execution_id
          ? `device.command.executed:${pendingCommand.command_execution_id}`
          : input.providerEventId || null,
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
          estate_id: device?.estate_id || null,
          building_id: device?.building_id || device?.metadata?.building_id || null,
          home_id: device?.home_id || null,
          room_id: device?.room_id || null,
          ownership_class: device?.ownership_class || device?.metadata?.ownership_class || device?.metadata?.oyi?.ownership_class || null,
          projection_policy: device?.projection_policy || device?.visibility_policy || device?.metadata?.projection_policy || null,
          visibility_policy: device?.visibility_policy || null,
          control_policy: device?.control_policy || null,
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
          provider_authorization_recovered: authorizationRecovered,
          previous_provider_error: previousProviderError?.classification || null,
          command_execution_id: pendingCommand?.command_execution_id || null,
          actor_id: pendingCommand?.actor_id || null,
          actor_role: pendingCommand?.actor_role || null,
          estate_id: device?.estate_id || null,
          building_id: device?.building_id || device?.metadata?.building_id || null,
          home_id: device?.home_id || null,
          room_id: device?.room_id || null,
          ownership_class: device?.ownership_class || device?.metadata?.ownership_class || device?.metadata?.oyi?.ownership_class || null,
          projection_policy: device?.projection_policy || device?.visibility_policy || device?.metadata?.projection_policy || null,
        },
      }).catch((error) => logger.error("device_runtime_signal_failed", { error, device_id: entry.device_id }));
    }
    return { snapshot: this.snapshot(entry), previousState, change, payload };
  }

  markDirty(deviceId: string) {
    const entry = this.cache.get(String(deviceId));
    if (entry) entry.dirty = true;
  }

  async finalizePendingCommandFailure(device: Record<string, any>, input: {
    commandExecutionId: string;
    error?: string | null;
    providerStatus?: string | null;
    source?: string | null;
  }) {
    const entry = this.cache.get(String(device.id));
    if (!entry) return null;
    const pendingCommand = entry.state?._oyi_pending_command && typeof entry.state._oyi_pending_command === "object"
      ? entry.state._oyi_pending_command as Record<string, any>
      : null;
    if (!pendingCommand || String(pendingCommand.command_execution_id || "") !== String(input.commandExecutionId || "")) return this.snapshot(entry);
    const runtimeTimestamp = new Date(this.now()).toISOString();
    entry.state._oyi_command_confirmation = {
      command: pendingCommand.command,
      source: pendingCommand.source || input.source || null,
      provider_accepted_at: pendingCommand.provider_accepted_at || null,
      command_execution_id: pendingCommand.command_execution_id || null,
      actor_id: pendingCommand.actor_id || null,
      actor_role: pendingCommand.actor_role || null,
      failed_at: runtimeTimestamp,
      confirmation: "failed",
      error: input.error || "The provider did not complete the command.",
    };
    delete entry.state._oyi_pending_command;
    entry.dirty = false;
    entry.runtime_timestamp = runtimeTimestamp;
    entry.summary = summarizeDeviceFrontendContract(device, {
      status: entry.state,
      last_seen: entry.last_refresh,
      updated_at: entry.runtime_timestamp,
    });
    try {
      await this.persist(entry);
    } catch (error) {
      logger.error("device_runtime_pending_command_failure_persist_failed", { error, device_id: entry.device_id });
    }
    const payload = this.websocketPayload(entry, input.source || "command_failure", `device.command.failed:${input.commandExecutionId}`, null);
    this.broadcast(entry, payload);
    logger.info("optimistic_state_rolled_back", {
      device: entry.device_id,
      channel: Object.keys(pendingCommand.command || {}).find((key) => /^switch_\d+$/i.test(key)) || null,
      command_execution_id: input.commandExecutionId,
      restored_state: "last_confirmed",
    });
    return this.snapshot(entry);
  }

  markViewed(deviceId: string, input: {
    ttlMs?: number;
    source?: string;
    estateId?: string | null;
    homeId?: string | null;
    actorId?: string | null;
  } = {}) {
    const entry = this.cache.get(String(deviceId));
    if (!entry) return null;
    const now = this.now();
    const ttlMs = Math.max(15_000, Math.min(Number(input.ttlMs || 45_000), 120_000));
    const previousUntil = Number(entry.viewed_until_ms || 0);
    const active = previousUntil > now;
    const renewWindowMs = Math.floor(ttlMs / 2);
    const shouldRenew = !active || previousUntil - now < renewWindowMs;
    const nextUntil = shouldRenew ? now + ttlMs : previousUntil;
    const leaseKey = leaseKeyHash({ deviceId: entry.device_id, actorId: input.actorId, homeId: input.homeId || entry.device?.home_id, source: input.source });
    entry.accessed_at_ms = now;
    entry.last_viewed_at_ms = now;
    entry.viewed_until_ms = nextUntil;
    entry.refresh_class = "currently_viewed";
    if (!active) {
      logger.info("device_runtime_view_lease_acquired", {
        device_id: entry.device_id,
        source: input.source || "device_panel",
        estate_id: input.estateId || entry.device?.estate_id || null,
        home_id: input.homeId || entry.device?.home_id || null,
        actor_id: input.actorId || null,
        lease_key: leaseKey,
        reason: input.source || "device_panel",
        previous_expires_at: previousUntil ? new Date(previousUntil).toISOString() : null,
        lease_expires_at: new Date(nextUntil).toISOString(),
        ttl_ms: ttlMs,
        current_logical_lease_count: this.stats().currently_viewed,
      });
    } else if (shouldRenew) {
      logger.info("device_runtime_view_lease_renewed", {
        device_id: entry.device_id,
        source: input.source || "device_panel",
        estate_id: input.estateId || entry.device?.estate_id || null,
        home_id: input.homeId || entry.device?.home_id || null,
        actor_id: input.actorId || null,
        lease_key: leaseKey,
        reason: input.source || "device_panel",
        previous_expires_at: new Date(previousUntil).toISOString(),
        lease_expires_at: new Date(nextUntil).toISOString(),
        ttl_ms: ttlMs,
        current_logical_lease_count: this.stats().currently_viewed,
      });
    } else {
      logger.debug("device_runtime_view_lease_reused", {
        device_id: entry.device_id,
        source: input.source || "device_panel",
        estate_id: input.estateId || entry.device?.estate_id || null,
        home_id: input.homeId || entry.device?.home_id || null,
        actor_id: input.actorId || null,
        lease_key: leaseKey,
        reason: input.source || "device_panel",
        lease_expires_at: new Date(nextUntil).toISOString(),
        ttl_ms: ttlMs,
        current_logical_lease_count: this.stats().currently_viewed,
      });
    }
    return this.snapshot(entry);
  }

  releaseViewed(deviceId: string, input: {
    source?: string;
    estateId?: string | null;
    homeId?: string | null;
    actorId?: string | null;
  } = {}) {
    const entry = this.cache.get(String(deviceId));
    if (!entry) return null;
    const now = this.now();
    const previousUntil = Number(entry.viewed_until_ms || 0);
    const leaseKey = leaseKeyHash({ deviceId: entry.device_id, actorId: input.actorId, homeId: input.homeId || entry.device?.home_id, source: input.source });
    if (previousUntil > now) {
      entry.viewed_until_ms = 0;
      entry.last_viewed_at_ms = undefined;
      if (entry.refresh_class === "currently_viewed") entry.refresh_class = undefined;
      logger.info("device_runtime_view_lease_released", {
        device_id: entry.device_id,
        source: input.source || "device_panel",
        reason: input.source || "device_panel",
        estate_id: input.estateId || entry.device?.estate_id || null,
        home_id: input.homeId || entry.device?.home_id || null,
        actor_id: input.actorId || null,
        lease_key: leaseKey,
        previous_expires_at: new Date(previousUntil).toISOString(),
        released_at: new Date(now).toISOString(),
        ttl_ms: Math.max(0, previousUntil - now),
        current_logical_lease_count: this.stats().currently_viewed,
      });
    }
    return this.snapshot(entry);
  }

  isRefreshSuppressed(deviceId: string) {
    const entry = this.cache.get(String(deviceId));
    if (!entry?.retry_after) return false;
    return new Date(entry.retry_after).getTime() > this.now();
  }

  refresh(deviceOrId: Record<string, any> | string, priority: DeviceRuntimeRefreshPriority = "normal", reason = "requested") {
    const deviceId = typeof deviceOrId === "string" ? deviceOrId : String(deviceOrId?.id || "");
    if (!deviceId) return Promise.resolve(null);
    if (this.isRefreshSuppressed(deviceId)) {
      operationalMetrics.increment("oyi_device_runtime_refresh_suppressed_total", {
        adapter: adapterName(typeof deviceOrId === "string" ? this.cache.get(deviceId)?.device || {} : deviceOrId),
        reason: providerErrorFromState(this.cache.get(deviceId)?.state)?.classification || "authorization_backoff",
      });
      return Promise.resolve(this.get(deviceId));
    }
    const existing = this.refreshes.get(deviceId);
    if (existing) {
      operationalMetrics.increment("oyi_device_runtime_refresh_coalesced_total", {
        adapter: adapterName(typeof deviceOrId === "string" ? this.cache.get(deviceId)?.device || {} : deviceOrId),
        reason,
      });
      logger.debug("device_runtime_refresh_coalesced", { device_id: deviceId, reason, in_flight_refreshes: this.refreshes.size });
      return existing;
    }
    const queued = this.queue.enqueue(async () => {
      const device = typeof deviceOrId === "string" ? await this.resolveDeviceRecord(deviceId) : deviceOrId;
      if (!device?.id) return null;
      const startedAt = this.now();
      const cached = this.cache.get(deviceId);
      if (cached) cached.last_refresh_attempt_ms = startedAt;
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
        return this.handleProviderFailure(device, error, reason, this.now() - startedAt);
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

  scheduleRefresh(device: Record<string, any>, input: { priority?: DeviceRuntimeRefreshPriority; reason?: string; delayMs?: number; markDirty?: boolean } = {}) {
    if (input.markDirty !== false) this.markDirty(String(device.id));
    const run = () => {
      logger.info("device_command_priority_refresh_joined", {
        device_id: String(device.id || ""),
        reason: input.reason || "scheduled",
        priority: input.priority || "high",
        in_flight: this.refreshes.has(String(device.id || "")),
      });
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
    const now = this.now();
    return {
      cache_entries: this.cache.size,
      in_flight_refreshes: this.refreshes.size,
      in_flight_hydrations: this.hydrations.size,
      refresh_queue: this.queue.stats(),
      currently_viewed: Array.from(this.cache.values()).filter((entry) => Number(entry.viewed_until_ms || 0) > now).length,
      authorization_suppressed: Array.from(this.cache.values()).filter((entry) => this.isRefreshSuppressed(entry.device_id)).length,
    };
  }

  async clearAuthorizationSuppressionForDevices(devices: Array<Record<string, any>>) {
    await this.hydrateMany(devices);
    let cleared = 0;
    for (const device of devices) {
      const entry = this.cache.get(String(device?.id || ""));
      const providerError = providerErrorFromState(entry?.state);
      if (!entry || !providerError || !["permission_denied", "device_not_linked", "integration_expired", "authentication_failed"].includes(providerError.classification)) continue;
      entry.state._oyi_runtime = {
        ...runtimeMetadata(entry.state),
        next_retry_at: null,
        provider_error: { ...providerError, failure_count: 0, next_retry_at: null },
      };
      entry.retry_after = null;
      entry.provider_error = { ...providerError, failure_count: 0, next_retry_at: null };
      entry.dirty = true;
      try {
        await this.persist(entry);
      } catch (error) {
        logger.error("device_runtime_authorization_reset_persist_failed", { error, device_id: entry.device_id });
      }
      cleared += 1;
    }
    return cleared;
  }

  async clearAuthorizationSuppressionForIntegration(ownerUserId: string, tuyaUid?: string | null) {
    const { data, error } = await supabaseAdmin
      .from("devices")
      .select(DEFAULT_DEVICE_SELECT)
      .or("vendor.eq.tuya,adapter.eq.tuya,provider.eq.tuya")
      .limit(5_000);
    if (error) throw error;
    const devices = (data || []).filter((device: any) => {
      const ownerMatches = integrationOwner(device) === String(ownerUserId || "").trim();
      const uidMatches = tuyaUid ? integrationUid(device) === String(tuyaUid).trim() : false;
      return ownerMatches || uidMatches;
    });
    return this.clearAuthorizationSuppressionForDevices(devices);
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
      provider_error: entry.provider_error,
      authorization_state: entry.authorization_state,
      provider_warning: entry.provider_warning,
      retry_after: entry.retry_after,
      last_successful_refresh: entry.last_successful_refresh,
      next_refresh_at: entry.next_refresh_at_ms ? new Date(entry.next_refresh_at_ms).toISOString() : null,
      refresh_class: entry.refresh_class || null,
      viewed_until_at: Number(entry.viewed_until_ms || 0) > this.now() ? new Date(Number(entry.viewed_until_ms)).toISOString() : null,
    };
  }

  private refreshDeadline(entry: RuntimeEntry, snapshot: DeviceRuntimeSnapshot, now: number) {
    const providerDisconnected = ["authorization_required", "degraded"].includes(String(snapshot.summary.provider_health || "")) || Boolean(snapshot.retry_after);
    const offline = snapshot.summary.provider_health === "offline" || snapshot.summary.health_status === "offline" || snapshot.summary.canonical_state?.availability === "offline";
    const critical = String(snapshot.summary.device_family || "").match(/lock|camera|security/) || snapshot.summary.canonical_state?.batteryLevel === "critical";
    const viewedUntil = Number(entry.viewed_until_ms || 0);
    const viewActive = viewedUntil > now;
    if (!viewActive && viewedUntil && entry.refresh_class === "currently_viewed") {
      logger.info("device_runtime_view_lease_expired", {
        device_id: entry.device_id,
        estate_id: entry.device?.estate_id || null,
        home_id: entry.device?.home_id || null,
        lease_key: leaseKeyHash({ deviceId: entry.device_id, homeId: entry.device?.home_id, source: "device_panel" }),
        reason: "device_panel",
        lease_expired_at: new Date(viewedUntil).toISOString(),
        ttl_ms: 0,
        current_logical_lease_count: this.stats().currently_viewed,
      });
      entry.viewed_until_ms = 0;
    }
    const ageSinceAccess = viewActive ? now - (entry.last_viewed_at_ms || entry.accessed_at_ms || now) : Number.POSITIVE_INFINITY;
    const ageSinceAttempt = now - (entry.last_refresh_attempt_ms || 0);
    let refreshClass: NonNullable<RuntimeEntry["refresh_class"]> = "inactive";
    let interval = INACTIVE_REFRESH_INTERVAL_MS;
    if (providerDisconnected) {
      refreshClass = "provider_disconnected";
      interval = PROVIDER_DISCONNECTED_REFRESH_INTERVAL_MS;
    } else if (offline) {
      refreshClass = "offline";
      interval = OFFLINE_REFRESH_INTERVAL_MS;
    } else if (critical && viewActive && ageSinceAccess <= ACTIVE_WINDOW_MS) {
      refreshClass = "active_critical";
      interval = CRITICAL_REFRESH_INTERVAL_MS;
    } else if (entry.dirty) {
      refreshClass = "recently_commanded";
      interval = 0;
    } else if (viewActive && ageSinceAccess <= ACTIVE_WINDOW_MS) {
      refreshClass = "currently_viewed";
      interval = ACTIVE_REFRESH_INTERVAL_MS;
    } else if (Number.isFinite(ageSinceAccess) && ageSinceAccess <= RECENT_WINDOW_MS) {
      refreshClass = "recently_active";
      interval = RECENT_REFRESH_INTERVAL_MS;
    }
    const jitterMs = deterministicJitterMs(entry.device_id, interval);
    const nextRefreshAt = (entry.last_refresh_attempt_ms || new Date(entry.last_refresh).getTime() || now) + interval + jitterMs;
    const due = entry.dirty || (snapshot.stale && ageSinceAttempt >= interval && now >= nextRefreshAt);
    return { due, refreshClass, interval, jitterMs, nextRefreshAt, ageSinceAttempt };
  }

  private websocketPayload(entry: RuntimeEntry, source: string, providerEventId?: string | null, event?: Record<string, any> | null) {
    const snapshot = this.snapshot(entry);
    const presentation = entry.summary.canonical_state
      ? buildCanonicalDevicePresentation(entry.device, entry.summary.canonical_state, { ...entry.summary, normalized_state: entry.summary.normalized_state })
      : entry.summary.canonical_presentation || null;
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
      room_name: entry.device?.room_name || entry.device?.metadata?.room_name || null,
      state: entry.state,
      summary: entry.summary,
      normalized_state: entry.summary.normalized_state,
      canonical_state: entry.summary.canonical_state,
      canonicalState: entry.summary.canonical_state,
      canonical_presentation: presentation,
      presentation,
      primary_state: entry.summary.primary_state,
      health_status: entry.summary.health_status,
      provider_health: entry.summary.provider_health,
      provider_error: snapshot.provider_error,
      authorization_state: snapshot.authorization_state,
      provider_warning: snapshot.provider_warning,
      retry_after: snapshot.retry_after,
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
    let evaluated = 0;
    let suppressed = 0;
    let fresh = 0;
    let skipped = 0;
    const candidates = Array.from(this.cache.values())
      .filter((entry) => {
        evaluated += 1;
        if (this.isRefreshSuppressed(entry.device_id)) {
          suppressed += 1;
          return false;
        }
        const snapshot = this.snapshot(entry);
        const deadline = this.refreshDeadline(entry, snapshot, now);
        entry.refresh_class = deadline.refreshClass;
        entry.next_refresh_at_ms = deadline.nextRefreshAt;
        if (!snapshot.stale && !entry.dirty) {
          fresh += 1;
          return false;
        }
        if (!deadline.due) {
          skipped += 1;
          return false;
        }
        return true;
      })
      .sort((a, b) => Number(b.dirty) - Number(a.dirty) || (a.last_viewed_at_ms || a.accessed_at_ms || 0) - (b.last_viewed_at_ms || b.accessed_at_ms || 0))
      .slice(0, 25);
    operationalMetrics.gauge("oyi_device_runtime_scheduler_evaluated", evaluated);
    operationalMetrics.gauge("oyi_device_runtime_scheduler_due", candidates.length);
    operationalMetrics.gauge("oyi_device_runtime_scheduler_skipped", skipped + fresh + suppressed);
    if (evaluated || candidates.length) {
      logger.debug("device_runtime_scheduler_tick", {
        evaluated,
        due: candidates.length,
        skipped,
        fresh,
        suppressed,
        refresh_classes: Array.from(this.cache.values()).reduce((acc, entry) => {
          const key = entry.refresh_class || "unclassified";
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        queue: this.queue.stats(),
      });
    }
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

  private async handleProviderFailure(device: Record<string, any>, error: unknown, reason: string, providerLatencyMs: number) {
    const deviceId = String(device.id);
    const nowIso = new Date(this.now()).toISOString();
    const previousEntry = this.cache.get(deviceId) || null;
    const previousState = previousEntry?.state
      ? { ...previousEntry.state, _oyi_runtime: { ...runtimeMetadata(previousEntry.state) } }
      : null;
    const previousError = providerErrorFromState(previousEntry?.state);
    const classified = classifyProviderError(error, {
      provider: String(device?.provider || device?.vendor || adapterName(device)),
      operation: reason,
      device,
      occurredAt: nowIso,
    });
    const authorizationFailure = ["permission_denied", "device_not_linked", "integration_expired", "authentication_failed"].includes(classified.classification);
    const failureCount = Number(previousError?.failure_count || 0) + 1;
    const backoffMs = authorizationFailure
      ? Math.min(AUTHORIZATION_BACKOFF_MAX_MS, AUTHORIZATION_BACKOFF_INITIAL_MS * (2 ** Math.max(0, failureCount - 1)))
      : 0;
    const nextRetryAt = backoffMs ? new Date(this.now() + backoffMs).toISOString() : null;
    const providerError: CanonicalProviderError = {
      ...classified,
      failure_count: failureCount,
      next_retry_at: nextRetryAt,
    };

    if (!previousEntry) {
      const baseline = enrichDeviceProviderState({
        state: { online: null },
        metadata: device?.metadata || {},
        device,
        provider: classified.provider,
        adapter: adapterName(device),
      });
      this.set(device, {
        ...baseline,
        provider_health: authorizationFailure ? "authorization_required" : "degraded",
        activity_summary: classified.safe_message,
      }, {
        runtimeTimestamp: nowIso,
        lastRefresh: nowIso,
        providerLatencyMs,
        dirty: !authorizationFailure,
      });
    }

    const entry = this.cache.get(deviceId)!;
    const previousRuntime = runtimeMetadata(entry.state);
    const attentionKey = `${classified.provider}:${classified.classification}:${integrationOwner(device) || integrationUid(device) || deviceId}`;
    const shouldEmitAttention = authorizationFailure && previousRuntime.provider_attention_key !== attentionKey;
    entry.state = {
      ...entry.state,
      provider_health: authorizationFailure ? "authorization_required" : "degraded",
      activity_summary: classified.safe_message,
      _oyi_runtime: {
        ...previousRuntime,
        runtime_timestamp: nowIso,
        provider_latency_ms: providerLatencyMs,
        provider_error: providerError,
        authorization_state: classified.authorization_state,
        provider_warning: classified.safe_message,
        next_retry_at: nextRetryAt,
        provider_last_attempt_at: nowIso,
      },
    };
    entry.runtime_timestamp = nowIso;
    entry.provider_latency_ms = providerLatencyMs;
    entry.provider_error = providerError;
    entry.authorization_state = classified.authorization_state;
    entry.provider_warning = classified.safe_message;
    entry.retry_after = nextRetryAt;
    entry.dirty = !authorizationFailure;
    entry.summary = summarizeDeviceFrontendContract(device, {
      status: entry.state,
      last_seen: entry.last_refresh,
      updated_at: entry.runtime_timestamp,
    });

    try {
      await this.persist(entry);
    } catch (persistError) {
      operationalMetrics.increment("oyi_device_runtime_persistence_failures_total");
      logger.error("device_runtime_provider_error_persist_failed", { error: persistError, device_id: deviceId });
    }
    this.broadcast(entry, this.websocketPayload(entry, "provider_error"));
    operationalMetrics.increment("oyi_device_runtime_refresh_failures_total", {
      adapter: adapterName(device),
      classification: classified.classification,
    });
    logger.warn("device_runtime_provider_refresh_failed", {
      device_id: deviceId,
      external_id: device?.external_id || null,
      adapter: adapterName(device),
      reason,
      provider_error: classified.classification,
      provider_code: classified.provider_code,
      authorization_state: classified.authorization_state,
      next_retry_at: nextRetryAt,
    });

    if (shouldEmitAttention) {
      try {
        await this.emitSignal({
          eventType: "device.provider.authorization_required",
          source: "provider_reported",
          provider: classified.provider,
          adapter: adapterName(device),
          providerEventId: attentionKey,
          estateId: device?.estate_id || null,
          homeId: device?.home_id || null,
          roomId: device?.room_id || null,
          device: {
            id: deviceId,
            name: String(device?.name || "Device"),
            type: String(device?.type || ""),
            category: String(device?.category || ""),
            external_id: device?.external_id || null,
            vendor: String(device?.vendor || ""),
            adapter: adapterName(device),
            provider: classified.provider,
            metadata: device?.metadata || {},
          },
          previousState,
          newState: entry.state,
          occurredAt: nowIso,
          telemetrySummary: {
            changed_keys: [],
            changed_count: 0,
            online: entry.state?.normalized_state?.online ?? null,
            power_state: entry.state?.normalized_state?.power ?? null,
          },
          extraMetadata: {
            runtime_v2: true,
            provider_error: classified.classification,
            provider_code: classified.provider_code,
            authorization_state: classified.authorization_state,
            safe_message: classified.safe_message,
            suggested_remediation: classified.suggested_remediation,
            integration_owner_user_id: integrationOwner(device),
            integration_uid: integrationUid(device),
            deduplicated_attention: true,
          },
        });
        entry.state._oyi_runtime = {
          ...runtimeMetadata(entry.state),
          provider_attention_key: attentionKey,
          provider_attention_emitted_at: nowIso,
        };
        await this.persist(entry).catch((persistError) => logger.error("device_runtime_attention_dedupe_persist_failed", { error: persistError, device_id: deviceId }));
      } catch (signalError) {
        logger.error("device_runtime_authorization_attention_failed", { error: signalError, device_id: deviceId });
      }
    }
    return this.snapshot(entry);
  }
}

export const deviceRuntimeStateService = new DeviceRuntimeStateService();
