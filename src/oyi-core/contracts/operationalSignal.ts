export type SignalType =
  | "infrastructure"
  | "operational"
  | "human"
  | "financial"
  | "security"
  | "environmental"
  | "ai"
  | "automation"
  | "maintenance"
  | "community"
  | "communication"
  | "registry"
  | "lifecycle"
  | "telemetry";

export type SignalSeverity = "info" | "attention" | "warning" | "critical";
export type SignalPriority = "low" | "normal" | "high" | "urgent";
export type SignalOrigin =
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
export type SignalInitiatorType =
  | "resident"
  | "operator"
  | "admin"
  | "executive"
  | "automation"
  | "device"
  | "provider"
  | "system";

export type SignalSource =
  | "infrastructure_registry"
  | "device_adapter"
  | "tuya"
  | "matter"
  | "mqtt"
  | "ble"
  | "onvif"
  | "camera"
  | "smart_lock"
  | "water_meter"
  | "energy_meter"
  | "environmental_sensor"
  | "edge_runtime"
  | "estate_registry"
  | "visitor_registry"
  | "resident_action"
  | "maintenance"
  | "accounting"
  | "wallet"
  | "community"
  | "service"
  | "report"
  | "office"
  | "consumer"
  | "ai"
  | "automation"
  | "future_module"
  | string;

export type SignalEntity = {
  id?: string | null;
  type?: string | null;
  name?: string | null;
  status?: string | null;
};

export type SignalScope = {
  id?: string | null;
  name?: string | null;
};

export type SignalActor = {
  id?: string | null;
  type?: "operator" | "resident" | "visitor" | "system" | "ai" | "automation" | string | null;
  name?: string | null;
  role?: string | null;
};

export type SignalEvidence = {
  id?: string | null;
  type?: string | null;
  source?: string | null;
  summary?: string | null;
  uri?: string | null;
  timestamp?: string | null;
  metadata?: Record<string, unknown>;
};

export type NormalizedSignal = {
  id: string;
  type: SignalType;
  source: SignalSource;
  domain: string;
  origin: SignalOrigin;
  initiatorType: SignalInitiatorType;
  initiatorId: string | null;
  estateId: string | null;
  buildingId: string | null;
  unitId: string | null;
  provider: string | null;
  providerEventId: string | null;
  sessionId: string | null;
  runtimeId: string | null;
  correlationId: string | null;
  triggerReason: string | null;
  verified: boolean;
  verificationMethod: string | null;
  trustScore: number;
  executionSource: string | null;
  entity: SignalEntity;
  estate: SignalScope;
  building: SignalScope;
  room: SignalScope;
  actor: SignalActor;
  severity: SignalSeverity;
  confidence: number;
  timestamp: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  evidence: SignalEvidence[];
};

export const SIGNAL_REQUIRED_FIELDS = [
  "id",
  "type",
  "source",
  "domain",
  "origin",
  "initiatorType",
  "initiatorId",
  "estateId",
  "buildingId",
  "unitId",
  "provider",
  "providerEventId",
  "sessionId",
  "runtimeId",
  "correlationId",
  "triggerReason",
  "verified",
  "verificationMethod",
  "trustScore",
  "executionSource",
  "entity",
  "estate",
  "building",
  "room",
  "actor",
  "severity",
  "confidence",
  "timestamp",
  "context",
  "metadata",
  "evidence",
] as const;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const next = text(value).toLowerCase();
  if (!next) return fallback;
  if (["true", "1", "yes", "verified", "confirmed"].includes(next)) return true;
  if (["false", "0", "no", "unverified", "pending"].includes(next)) return false;
  return fallback;
}

function scopeFrom(value: unknown): SignalScope {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const next = value as Record<string, unknown>;
    return {
      id: text(next.id || next.estate_id || next.building_id || next.room_id) || null,
      name: text(next.name || next.label) || null,
    };
  }
  return { id: text(value) || null, name: null };
}

function originFrom(input: Partial<NormalizedSignal> & Record<string, unknown>, metadata: Record<string, unknown>, domain: string, source: string): SignalOrigin {
  const explicit = text(input.origin || metadata.origin || input.executionSource || metadata.executionSource).toLowerCase();
  if (explicit === "consumer_app" || explicit === "facility_app" || explicit === "office_app" || explicit === "automation" || explicit === "edge_agent" || explicit === "voice_assistant" || explicit === "api" || explicit === "provider" || explicit === "backend" || explicit === "scheduler" || explicit === "system" || explicit === "physical") {
    return explicit;
  }
  const haystack = `${source} ${domain} ${text(input.type)} ${JSON.stringify(metadata)}`.toLowerCase();
  if (/physical|switch|tap|press|device state|lock|sensor|meter|tuya|onvif|mqtt|ble|matter|camera/.test(haystack)) return "physical";
  if (/consumer/.test(haystack)) return "consumer_app";
  if (/facility/.test(haystack)) return "facility_app";
  if (/office/.test(haystack)) return "office_app";
  if (/automation|scene|rule/.test(haystack)) return "automation";
  if (/edge/.test(haystack)) return "edge_agent";
  if (/voice|assistant/.test(haystack)) return "voice_assistant";
  if (/api|webhook|http/.test(haystack)) return "api";
  if (/provider|tuya|onvif|mqtt|ble|matter/.test(haystack)) return "provider";
  if (/backend|worker|queue/.test(haystack)) return "backend";
  if (/schedule|cron/.test(haystack)) return "scheduler";
  return "system";
}

function initiatorTypeFrom(input: Partial<NormalizedSignal> & Record<string, unknown>, metadata: Record<string, unknown>, source: string, origin: SignalOrigin): SignalInitiatorType {
  const explicit = text(input.initiatorType || metadata.initiatorType || input.actor_type || input.actorType || metadata.actor_type).toLowerCase();
  if (explicit === "resident" || explicit === "operator" || explicit === "admin" || explicit === "executive" || explicit === "automation" || explicit === "device" || explicit === "provider" || explicit === "system") {
    return explicit;
  }
  const role = text(input.actor_role || input.actorRole || metadata.actor_role).toLowerCase();
  if (/resident|tenant|occupant/.test(role)) return "resident";
  if (/executive|director|leadership/.test(role)) return "executive";
  if (/admin|super_admin|estate_admin|ochiga_admin/.test(role)) return "admin";
  if (/operator|security|manager|facility/.test(role)) return "operator";
  if (origin === "automation") return "automation";
  if (origin === "provider") return "provider";
  if (origin === "physical") return /device|sensor|lock|meter|camera/.test(`${source} ${text(input.type)}`.toLowerCase()) ? "device" : "provider";
  return "system";
}

export function signalSeverity(value: unknown): SignalSeverity {
  const next = text(value).toLowerCase();
  if (/critical|emergency|panic|intrusion|fire/.test(next)) return "critical";
  if (/warning|high|failed|offline|unreachable|blocked|overdue|error|degraded/.test(next)) return "warning";
  if (/attention|pending|review|unknown|medium/.test(next)) return "attention";
  return "info";
}

export function signalConfidence(value: unknown, fallback = 0.65) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
  const next = text(value).toLowerCase();
  if (next === "confirmed") return 0.95;
  if (next === "high" || next === "likely") return 0.85;
  if (next === "medium" || next === "possible") return 0.65;
  if (next === "low") return 0.4;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

export function signalTypeFromDomain(value: unknown): SignalType {
  const next = text(value).toLowerCase();
  if (/wallet|payment|account|finance|transaction/.test(next)) return "financial";
  if (/security|access|visitor|gate|lock|camera|incident/.test(next)) return "security";
  if (/environment|sensor|air|waste|humidity|temperature|water|energy|utility/.test(next)) return "environmental";
  if (/maintenance|support|work.?order/.test(next)) return "maintenance";
  if (/community|announcement|post|moderation/.test(next)) return "community";
  if (/message|communication|notification/.test(next)) return "communication";
  if (/ai|oyi|prediction|intelligence/.test(next)) return "ai";
  if (/automation|rule|scene/.test(next)) return "automation";
  if (/registry|estate|home|resident|room/.test(next)) return "registry";
  if (/lifecycle|status|state/.test(next)) return "lifecycle";
  if (/telemetry|meter|edge|device|infrastructure|provider/.test(next)) return "telemetry";
  return "operational";
}

export function normalizeSignal(input: Partial<NormalizedSignal> & Record<string, unknown>): NormalizedSignal {
  const metadata = asRecord(input.metadata);
  const context = asRecord(input.context);
  const entity = asRecord(input.entity);
  const actor = asRecord(input.actor);
  const rawEvidence = Array.isArray(input.evidence) ? input.evidence : [];
  const timestamp = text(input.timestamp || input.created_at || input.updated_at || metadata.timestamp) || new Date().toISOString();
  const domain = text(input.domain || metadata.domain || input.source || input.type || "operational");
  const type = input.type || signalTypeFromDomain(domain);
  const source = text(input.source || metadata.source || domain || "future_module");
  const entityId = text(entity.id || input.entity_id || input.deviceId || input.device_id || metadata.entity_id || input.id);
  const estate = scopeFrom(input.estate || input.estate_id || input.estateId || metadata.estate_id);
  const building = scopeFrom(input.building || input.building_id || input.buildingId || metadata.building_id);
  const room = scopeFrom(input.room || input.room_id || input.roomId || metadata.room_id);
  const origin = originFrom(input, metadata, domain, source);
  const initiatorType = initiatorTypeFrom(input, metadata, source, origin);
  const initiatorId =
    text(input.initiatorId || metadata.initiatorId || actor.id || input.actor_id || input.actorId || metadata.actor_id || (input.requestedBy as Record<string, unknown> | undefined)?.userId) || null;
  const estateId = text(input.estateId || input.estate_id || metadata.estate_id || estate.id) || null;
  const buildingId = text(input.buildingId || input.building_id || metadata.building_id || building.id) || null;
  const unitId = text(input.unitId || input.unit_id || metadata.unit_id || context.unitId || (context.unit as Record<string, unknown> | undefined)?.id) || null;
  const provider = text(input.provider || metadata.provider || source) || null;
  const providerEventId = text(input.providerEventId || metadata.providerEventId || metadata.provider_event_id || metadata.event_id) || null;
  const sessionId = text(input.sessionId || metadata.sessionId || metadata.session_id) || null;
  const runtimeId = text(input.runtimeId || metadata.runtimeId || metadata.runtime_id) || null;
  const correlationId = text(input.correlationId || metadata.correlationId || metadata.correlation_id || sessionId || providerEventId || `${source}:${entityId || timestamp}`) || null;
  const triggerReason = text(input.triggerReason || metadata.triggerReason || metadata.trigger_reason || metadata.reason || metadata.message) || null;
  const verificationMethod = text(input.verificationMethod || metadata.verificationMethod || metadata.verification_method) || null;
  const verified = bool(input.verified ?? metadata.verified ?? metadata.confirmed, false);
  const trustScore = signalConfidence(input.trustScore ?? metadata.trustScore ?? metadata.trust_score ?? input.confidence ?? metadata.confidence);
  const executionSource = text(input.executionSource || metadata.executionSource || metadata.execution_source || origin) || null;

  return {
    id: text(input.id || metadata.id || `${source}:${entityId || timestamp}`),
    type,
    source,
    domain,
    origin,
    initiatorType,
    initiatorId,
    estateId,
    buildingId,
    unitId,
    provider,
    providerEventId,
    sessionId,
    runtimeId,
    correlationId,
    triggerReason,
    verified,
    verificationMethod,
    trustScore,
    executionSource,
    entity: {
      id: entityId || null,
      type: text(entity.type || input.entity_type || metadata.entity_type || type) || null,
      name: text(entity.name || input.title || input.name || metadata.name || metadata.title) || null,
      status: text(entity.status || input.status || metadata.status || metadata.state) || null,
    },
    estate,
    building,
    room,
    actor: {
      id: initiatorId,
      type: text(actor.type || input.actor_type || input.actorType || metadata.actor_type || source || "system") || null,
      name: text(actor.name || input.actor_name || input.actorName || metadata.actor_name) || null,
      role: text(actor.role || input.actor_role || input.actorRole || metadata.actor_role || (input.requestedBy as Record<string, unknown> | undefined)?.role) || null,
    },
    severity: signalSeverity(input.severity || input.status || metadata.status || metadata.state || metadata.health_status),
    confidence: signalConfidence(input.confidence ?? metadata.confidence),
    timestamp,
    context,
    metadata: {
      ...metadata,
      ...input,
      origin,
      initiatorType,
      initiatorId,
      estateId,
      buildingId,
      unitId,
      provider,
      providerEventId,
      sessionId,
      runtimeId,
      correlationId,
      triggerReason,
      verified,
      verificationMethod,
      trustScore,
      executionSource,
    },
    evidence: rawEvidence
      .map((item) => asRecord(item))
      .filter((item) => Object.keys(item).length > 0)
      .map((item) => ({
        id: text(item.id) || null,
        type: text(item.type || type) || null,
        source: text(item.source || source) || null,
        summary: text(item.summary || item.message || item.description) || null,
        uri: text(item.uri) || null,
        timestamp: text(item.timestamp || timestamp) || null,
        metadata: asRecord(item.metadata),
      })),
  };
}

export function validateSignal(signal: NormalizedSignal) {
  const issues: string[] = [];
  const nullableFields = new Set([
    "initiatorId",
    "estateId",
    "buildingId",
    "unitId",
    "provider",
    "providerEventId",
    "sessionId",
    "runtimeId",
    "correlationId",
    "triggerReason",
    "verificationMethod",
    "executionSource",
  ]);
  for (const field of SIGNAL_REQUIRED_FIELDS) {
    if (signal[field] === undefined || (signal[field] === null && !nullableFields.has(field))) issues.push(`Missing field: ${field}`);
  }
  if (!signal.domain) issues.push("Missing field: domain");
  if (!signal.id) issues.push("Missing field: id");
  if (!signal.timestamp || Number.isNaN(new Date(signal.timestamp).getTime())) issues.push("Invalid timestamp");
  if (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) issues.push("Confidence must be between 0 and 1");
  return { ok: issues.length === 0, issues };
}

export function signalPriority(signal: NormalizedSignal): SignalPriority {
  const summary = `${signal.severity} ${signal.domain} ${signal.entity.status || ""}`.toLowerCase();
  if (signal.severity === "critical") return "urgent";
  if (signal.severity === "warning" || /escalated|blocked|security|incident/.test(summary)) return "high";
  if (signal.severity === "attention" || /review|pending|visitor|maintenance/.test(summary)) return "normal";
  return "low";
}

export function signalDeduplicationKey(signal: NormalizedSignal) {
  return [
    signal.source,
    signal.type,
    signal.domain,
    text(signal.entity.id || signal.entity.name || "unknown").toLowerCase(),
    text(signal.room.id || signal.building.id || signal.estate.id || "scope").toLowerCase(),
    text(signal.entity.status).toLowerCase(),
  ].join(":");
}
