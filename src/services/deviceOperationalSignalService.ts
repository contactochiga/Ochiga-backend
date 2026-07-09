import { handleSignal } from "../core/control-plane";
import { SIGNAL_SCHEMA_VERSION } from "../core/control-plane/contracts";
import { runtimeTraceFields } from "../observability/runtimeContext";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { enrichDeviceProviderState } from "../device/runtime/deviceStateEnrichment";

type DeviceObservedSource =
  | "app"
  | "physical_switch"
  | "provider_reported"
  | "provider_app"
  | "watch"
  | "automation"
  | "scene"
  | "facility"
  | "system";

type OperationalOrigin =
  | "physical"
  | "consumer_app"
  | "facility_app"
  | "office_app"
  | "automation"
  | "edge_agent"
  | "voice_assistant"
  | "api"
  | "provider"
  | "backend"
  | "scheduler"
  | "system";

type RecentCommandContext = {
  eventType: string;
  source: DeviceObservedSource;
  actorId: string | null;
  userId: string | null;
  occurredAt: string | null;
  metadata: Record<string, any>;
} | null;

type DeviceTelemetrySummary = {
  changed_keys: string[];
  changed_count: number;
  online: boolean | null;
  power_state: boolean | null;
  provider_reported_at?: string | null;
  [key: string]: any;
};

export type DeviceOperationalSignalInput = {
  eventType:
    | "device.state.changed"
    | "device.power.on"
    | "device.power.off"
    | "device.physical_switch.detected"
    | "device.command.requested"
    | "device.command.executed"
    | "device.command.failed"
    | "device.offline"
    | "device.online"
    | "device.health.degraded"
    | "device.provider.sync"
    | "device.telemetry.received";
  source: DeviceObservedSource | string;
  provider?: string | null;
  adapter?: string | null;
  providerEventId?: string | null;
  estateId?: string | null;
  homeId?: string | null;
  roomId?: string | null;
  device: {
    id: string;
    name?: string | null;
    type?: string | null;
    category?: string | null;
    external_id?: string | null;
    vendor?: string | null;
    adapter?: string | null;
    provider?: string | null;
    metadata?: Record<string, any> | null;
  };
  previousState?: Record<string, any> | null;
  newState?: Record<string, any> | null;
  command?: Record<string, any> | null;
  actor?: {
    id?: string | null;
    role?: string | null;
    name?: string | null;
    type?: string | null;
  } | null;
  occurredAt?: string | null;
  telemetrySummary?: DeviceTelemetrySummary | null;
  extraMetadata?: Record<string, any> | null;
};

function text(value: unknown) {
  const next = String(value ?? "").trim();
  return next || null;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function boolValue(value: any): boolean | null {
  if (value === true || value === false) return value;
  const textValue = String(value ?? "").toLowerCase();
  if (["true", "on", "1", "yes", "active", "open"].includes(textValue)) return true;
  if (["false", "off", "0", "no", "inactive", "closed"].includes(textValue)) return false;
  return null;
}

function normalizeSource(source: string): DeviceObservedSource {
  const raw = String(source || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (/physical|wall|manual|local|button/.test(raw)) return "physical_switch";
  if (/watch/.test(raw)) return "watch";
  if (/automation/.test(raw)) return "automation";
  if (/scene/.test(raw)) return "scene";
  if (/facility|operator|admin/.test(raw)) return "facility";
  if (/smart_life|tuya_app|provider_app/.test(raw)) return "provider_app";
  if (/provider|tuya|mqtt|report|sync/.test(raw)) return "provider_reported";
  if (/consumer|resident|app|user/.test(raw)) return "app";
  return "system";
}

function commandOrigin(source: DeviceObservedSource): OperationalOrigin {
  if (source === "facility") return "facility_app";
  if (source === "app" || source === "watch") return "consumer_app";
  if (source === "automation" || source === "scene") return "automation";
  if (source === "provider_app" || source === "provider_reported") return "provider";
  if (source === "physical_switch") return "physical";
  return "system";
}

function eventSeverity(eventType: string) {
  if (/failed|offline|degraded/.test(eventType)) return "warning";
  if (/physical_switch|state.changed|provider.sync|telemetry.received/.test(eventType)) return "info";
  if (/command.requested/.test(eventType)) return "attention";
  return "info";
}

function confidenceFor(source: DeviceObservedSource, eventType: string, recent: RecentCommandContext) {
  if (recent && /command\.(requested|executed|queued)/.test(recent.eventType)) return 0.96;
  if (source === "physical_switch") return 0.92;
  if (source === "app" || source === "facility" || source === "watch" || source === "automation" || source === "scene") return 0.95;
  if (/offline|online/.test(eventType)) return 0.88;
  if (source === "provider_app") return 0.86;
  if (source === "provider_reported") return 0.8;
  return 0.65;
}

function trustScoreFor(source: DeviceObservedSource, eventType: string, recent: RecentCommandContext) {
  return confidenceFor(source, eventType, recent);
}

function flattenState(state: Record<string, any>, prefix = "", out: Record<string, any> = {}) {
  for (const [key, value] of Object.entries(state || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && key !== "_oyi_timeline") {
      flattenState(asRecord(value), path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

function changedKeys(previousState?: Record<string, any> | null, newState?: Record<string, any> | null) {
  const prev = flattenState(asRecord(previousState));
  const next = flattenState(asRecord(newState));
  const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)]));
  return keys.filter((key) => JSON.stringify(prev[key]) !== JSON.stringify(next[key]));
}

function powerState(state?: Record<string, any> | null) {
  const flat = flattenState(asRecord(state));
  for (const key of ["switch", "power", "on", "running", "enabled", "switch_1", "switch_2", "switch_3", "switch_4"]) {
    const next = boolValue((flat as any)[key]);
    if (next !== null) return next;
  }
  return null;
}

function deriveTelemetrySummary(previousState?: Record<string, any> | null, newState?: Record<string, any> | null) {
  const changed = changedKeys(previousState, newState);
  return {
    changed_keys: changed,
    changed_count: changed.length,
    online: boolValue(asRecord(newState).online),
    power_state: powerState(newState),
  } satisfies DeviceTelemetrySummary;
}

function deviceCapabilities(device: DeviceOperationalSignalInput["device"]) {
  const metadata = asRecord(device.metadata);
  const rawCaps = Array.isArray(metadata.capabilities) ? metadata.capabilities : [];
  const functions = Array.isArray(metadata.functions) ? metadata.functions : Array.isArray(metadata.raw?.functions) ? metadata.raw.functions : [];
  const functionCodes = functions.map((item: any) => String(item?.code || "")).filter(Boolean);
  return Array.from(new Set([...rawCaps.map((item: any) => String(item)), ...functionCodes]));
}

function controlProfile(device: DeviceOperationalSignalInput["device"]) {
  const haystack = [
    device.category,
    device.type,
    device.metadata?.remote_type,
    device.metadata?.ir_profile,
    device.metadata?.product_name,
    device.metadata?.model,
  ]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
  if (/camera|ipc|rtsp|onvif|dvr|nvr/.test(haystack)) return "camera";
  if (/air|ac|hvac|climate|thermostat/.test(haystack)) return "climate";
  if (/tv|remote|infrared|set_top|stb/.test(haystack)) return "ir_remote";
  if (/light|switch|plug|socket|relay/.test(haystack)) return "switch";
  return "generic";
}

function enrichedStateSummary(input: DeviceOperationalSignalInput) {
  return enrichDeviceProviderState({
    state: asRecord(input.newState),
    metadata: asRecord(input.device.metadata),
    device: {
      category: input.device.category,
      type: input.device.type,
      name: input.device.name,
      provider: input.device.provider || input.device.vendor || input.provider,
      adapter: input.device.adapter || input.device.vendor || input.adapter,
    },
    provider: input.provider || input.device.provider || input.device.vendor,
    adapter: input.adapter || input.device.adapter || input.device.vendor,
  });
}

async function recentCommandContext(deviceId: string, windowMs = 45_000): Promise<RecentCommandContext> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await supabaseAdmin
    .from("device_events")
    .select("event_type,source,actor_id,user_id,occurred_at,metadata")
    .eq("device_id", deviceId)
    .in("event_type", ["device.command.requested", "device.command.executed", "device.command.queued"])
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    eventType: String((data as any).event_type || ""),
    source: normalizeSource(String((data as any).source || "system")),
    actorId: text((data as any).actor_id),
    userId: text((data as any).user_id),
    occurredAt: text((data as any).occurred_at),
    metadata: asRecord((data as any).metadata),
  };
}

export async function isDuplicateDeviceTransition(input: {
  deviceId: string;
  eventType: string;
  source: string;
  state?: Record<string, any> | null;
  windowMs?: number;
}) {
  const since = new Date(Date.now() - (input.windowMs ?? 15_000)).toISOString();
  const { data, error } = await supabaseAdmin
    .from("device_events")
    .select("new_state,occurred_at")
    .eq("device_id", input.deviceId)
    .eq("event_type", input.eventType)
    .eq("source", normalizeSource(input.source))
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(3);
  if (error) return false;
  const fingerprint = JSON.stringify(asRecord(input.state));
  return (data || []).some((row: any) => JSON.stringify(asRecord(row?.new_state)) === fingerprint);
}

function detectObservedSource(input: DeviceOperationalSignalInput, recent: RecentCommandContext, telemetry: ReturnType<typeof deriveTelemetrySummary>) {
  const explicit = normalizeSource(String(input.source || "system"));
  if (input.eventType === "device.command.requested" || input.eventType === "device.command.executed" || input.eventType === "device.command.failed") {
    return explicit;
  }
  if (recent && ["app", "facility", "watch", "automation", "scene"].includes(recent.source)) {
    return recent.source;
  }
  if (explicit === "provider_reported" || explicit === "provider_app" || explicit === "system") {
    const switchLike = telemetry.changed_keys.some((key) => /(^|\.)(switch|power|on|running|enabled)/.test(key));
    if ((input.eventType === "device.power.on" || input.eventType === "device.power.off" || input.eventType === "device.state.changed") && switchLike) {
      return "physical_switch";
    }
  }
  return explicit;
}

function actorDetails(input: DeviceOperationalSignalInput, recent: RecentCommandContext, source: DeviceObservedSource) {
  if (input.actor?.id || input.actor?.role || input.actor?.name || input.actor?.type) {
    return {
      id: text(input.actor.id),
      role: text(input.actor.role),
      name: text(input.actor.name),
      type: text(input.actor.type || (source === "facility" ? "operator" : source === "app" ? "resident" : "system")),
    };
  }
  return {
    id: recent?.actorId || recent?.userId || null,
    role: text(recent?.metadata?.actor_role),
    name: text(recent?.metadata?.actor_name),
    type: source === "facility" ? "operator" : source === "app" ? "resident" : source === "physical_switch" ? "device" : "system",
  };
}

export async function emitOperationalDeviceSignal(input: DeviceOperationalSignalInput) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const recent = await recentCommandContext(String(input.device.id || ""));
  const telemetry = input.telemetrySummary || deriveTelemetrySummary(input.previousState, input.newState);
  const observedSource = detectObservedSource(input, recent, telemetry);
  const actor = actorDetails(input, recent, observedSource);
  const origin = commandOrigin(observedSource);
  const confidence = confidenceFor(observedSource, input.eventType, recent);
  const trustScore = trustScoreFor(observedSource, input.eventType, recent);
  const adapter = text(input.adapter || input.device.adapter || input.device.vendor || input.provider || "device_adapter");
  const provider = text(input.provider || input.device.provider || input.device.vendor || adapter);
  const externalId = text(input.device.external_id || input.device.metadata?.external_id);
  const enrichedState = enrichedStateSummary(input);
  const capabilities = Array.from(new Set([
    ...deviceCapabilities(input.device),
    ...(Array.isArray(enrichedState.capability_codes) ? enrichedState.capability_codes : []),
  ]));
  const resolvedControlProfile = text(enrichedState.control_profile) || controlProfile(input.device);
  const runtimeTrace = runtimeTraceFields();
  const signalPayload: any = {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    id: `${input.eventType}:${input.device.id}:${input.providerEventId || occurredAt}`,
    source: adapter || "device_adapter",
    type: "telemetry",
    domain: "infrastructure_devices",
    origin,
    initiatorType: actor.type === "resident" ? "resident" : actor.type === "operator" ? "operator" : observedSource === "physical_switch" ? "device" : observedSource === "provider_reported" || observedSource === "provider_app" ? "provider" : observedSource === "automation" || observedSource === "scene" ? "automation" : "system",
    initiatorId: actor.id,
    estateId: text(input.estateId),
    buildingId: null,
    unitId: text(input.homeId),
    provider,
    providerEventId: text(input.providerEventId),
    sessionId: text(recent?.metadata?.session_id),
    correlationId: text(recent?.metadata?.correlation_id || runtimeTrace.correlation_id || input.providerEventId || `${input.device.id}:${occurredAt}`),
    triggerReason: recent ? "matched_recent_oyi_command" : observedSource === "physical_switch" ? "no_recent_command_detected" : "provider_runtime_update",
    verified: Boolean(recent || observedSource === "app" || observedSource === "facility" || observedSource === "watch" || observedSource === "automation" || observedSource === "scene"),
    verificationMethod: recent ? "recent_command_match" : observedSource === "physical_switch" ? "provider_state_without_recent_command" : "provider_report",
    trustScore,
    executionSource: adapter,
    entity: {
      id: text(input.device.id),
      type: text(input.device.type || input.device.category || "device"),
      name: text(input.device.name || input.extraMetadata?.device_name),
      status: input.eventType,
    },
    estate: {
      id: text(input.estateId),
      name: text(input.extraMetadata?.estate_name),
    },
    building: {
      id: null,
      name: null,
    },
    room: {
      id: text(input.roomId),
      name: text(input.extraMetadata?.room_name),
    },
    actor: {
      id: actor.id,
      type: actor.type,
      name: actor.name,
      role: actor.role,
    },
    severity: eventSeverity(input.eventType),
    confidence,
    timestamp: occurredAt,
    context: {
      event_type: input.eventType,
      old_state: asRecord(input.previousState),
      new_state: asRecord(input.newState),
      changed_keys: telemetry.changed_keys || [],
      command_source: observedSource,
      recent_command: recent ? { event_type: recent.eventType, source: recent.source, occurred_at: recent.occurredAt } : null,
      control_profile: resolvedControlProfile,
      supported_capabilities: capabilities,
      telemetry_summary: telemetry,
      primary_state: enrichedState.primary_state,
      health_status: enrichedState.health_status,
      supported_controls: enrichedState.supported_controls,
      device_family: enrichedState.device_family,
      device_runtime: {
        adapter,
        provider,
        provider_event_id: text(input.providerEventId),
        external_id: externalId,
      },
    },
    metadata: {
      adapter,
      provider,
      external_id: externalId,
      provider_event_id: text(input.providerEventId),
      observed_source: observedSource,
      recent_command_source: recent?.source || null,
      command: asRecord(input.command),
      device_name: text(input.device.name),
      device_type: text(input.device.type),
      device_category: text(input.device.category),
      device_family: text(enrichedState.device_family),
      raw_provider_payload: asRecord(input.newState),
      previous_state: asRecord(input.previousState),
      changed_keys: telemetry.changed_keys || [],
      control_profile: resolvedControlProfile,
      supported_capabilities: capabilities,
      supported_controls: enrichedState.supported_controls,
      primary_state: enrichedState.primary_state,
      health_status: enrichedState.health_status,
      telemetry_summary: enrichedState.telemetry_summary,
      runtime_trace: runtimeTrace,
      ...asRecord(input.extraMetadata),
    },
    evidence: [
      {
        id: text(input.providerEventId || externalId || input.device.id),
        type: "device_state_payload",
        source: provider || adapter,
        summary: `${text(input.device.name || "Device")} emitted ${input.eventType}`,
        timestamp: occurredAt,
        metadata: {
          adapter,
          provider,
          external_id: externalId,
          previous_state: asRecord(input.previousState),
          new_state: asRecord(input.newState),
          changed_keys: telemetry.changed_keys || [],
        },
      },
    ],
  };
  return handleSignal(signalPayload);
}
