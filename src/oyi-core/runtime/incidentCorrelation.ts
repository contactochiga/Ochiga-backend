import type { NormalizedSignal, SignalSeverity } from "../contracts/operationalSignal";
import type { OperationalAwareness } from "./contextAwareness";

export type IncidentStatus = "open" | "acknowledged" | "monitoring" | "resolved" | "expired" | "suppressed";

export type IncidentCorrelation = {
  incidentKey: string;
  incidentType: string;
  domain: string;
  title: string;
  summary: string;
  status: IncidentStatus;
  severity: SignalSeverity;
  confidence: number;
  scope: Record<string, unknown>;
  affectedEntities: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  parentIncidentKey: string | null;
  suppressChildAwareness: boolean;
  recoveryOf: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function isCommandLifecycle(signal: NormalizedSignal) {
  const haystack = lower(`${signal.domain} ${signal.type} ${signal.metadata.event || ""} ${signal.metadata.lifecycle_stage || ""}`);
  return /device\.command|command_(requested|accepted|executed|confirmed|failed)|scene_action|automation_action/.test(haystack);
}

function isAuditRecursion(signal: NormalizedSignal) {
  return lower(`${signal.domain} ${signal.type} ${signal.source}`).includes("audit.recorded");
}

function isRecovery(signal: NormalizedSignal) {
  const haystack = lower(`${signal.domain} ${signal.type} ${signal.entity.status || ""} ${signal.metadata.status || ""} ${signal.metadata.event || ""}`);
  return /recovered|recovery|online|restored|resolved|healthy/.test(haystack);
}

function isUserOff(signal: NormalizedSignal) {
  const haystack = lower(`${signal.metadata.command_key || ""} ${signal.metadata.desired_state || ""} ${signal.entity.status || ""} ${signal.metadata.state || ""}`);
  return signal.initiatorType === "resident" && /(^|[^a-z])off([^a-z]|$)|false/.test(haystack);
}

function isExpiredOnly(signal: NormalizedSignal) {
  const haystack = lower(`${signal.entity.status || ""} ${signal.metadata.freshness || ""} ${signal.metadata.availability || ""}`);
  return /expired|stale/.test(haystack) && !/offline|provider_reports_offline/.test(haystack);
}

function isRoutinePrivateSignal(signal: NormalizedSignal) {
  const privacy = lower(`${signal.domain} ${signal.metadata.privacy_class || ""} ${signal.metadata.event || ""}`);
  const status = lower(`${signal.entity.status || ""} ${signal.metadata.status || ""} ${signal.metadata.availability || ""}`);
  return /resident_device_private|smart_access_private|home_private/.test(privacy)
    && signal.severity === "info"
    && !/offline|failed|tamper|alarm|wrong|denied|critical|warning|unreachable|recovery|recovered/.test(status);
}

function baseScope(signal: NormalizedSignal) {
  return {
    estate_id: signal.estateId || signal.estate.id || null,
    building_id: signal.buildingId || signal.building.id || null,
    home_id: signal.context.home_id || signal.metadata.home_id || null,
    room_id: signal.room.id || signal.metadata.room_id || null,
    entity_type: signal.entity.type || null,
    entity_id: signal.entity.id || null,
  };
}

function entityKey(signal: NormalizedSignal) {
  return text(signal.entity.id || signal.entity.name || "unknown");
}

function scopePrefix(signal: NormalizedSignal) {
  return [
    signal.estateId || signal.estate.id || "global",
    signal.context.home_id || signal.metadata.home_id || signal.buildingId || signal.building.id || "shared",
  ].join(":");
}

function outageFamily(signal: NormalizedSignal) {
  const haystack = lower(`${signal.domain} ${signal.source} ${signal.provider || ""} ${signal.metadata.provider || ""} ${signal.metadata.error_classification || ""}`);
  if (/provider|tuya|mqtt|onvif|matter|ble|gateway/.test(haystack)) return `provider:${signal.provider || signal.source}`;
  if (/power|electric|energy|water|internet|network|gateway/.test(haystack)) return "shared_infrastructure";
  return null;
}

export function correlateIncident(signal: NormalizedSignal, awareness: OperationalAwareness | null = null): IncidentCorrelation | null {
  if (isAuditRecursion(signal) || isCommandLifecycle(signal) || isUserOff(signal) || isExpiredOnly(signal) || isRoutinePrivateSignal(signal)) return null;

  const scope = baseScope(signal);
  const recovery = isRecovery(signal);
  const family = outageFamily(signal);
  const entity = entityKey(signal);
  const domain = lower(signal.domain || signal.type || "operational") || "operational";
  const status: IncidentStatus = recovery ? "resolved" : signal.severity === "info" ? "monitoring" : "open";
  const parentIncidentKey = family ? `incident:${scopePrefix(signal)}:${family}` : null;
  const incidentKey = `incident:${scopePrefix(signal)}:${domain}:${entity}`;

  return {
    incidentKey,
    incidentType: family || domain,
    domain,
    title: recovery ? `${signal.entity.name || entity} recovered` : awareness?.title || `${signal.entity.name || entity} requires attention`,
    summary: recovery ? "Recovery evidence resolved the active incident." : awareness?.summary || `${domain} signal requires operational review.`,
    status,
    severity: signal.severity,
    confidence: signal.confidence,
    scope,
    affectedEntities: [{ type: signal.entity.type || "entity", id: signal.entity.id || null, name: signal.entity.name || null }],
    evidence: signal.evidence.map((item) => ({ ...item })),
    parentIncidentKey: parentIncidentKey && parentIncidentKey !== incidentKey ? parentIncidentKey : null,
    suppressChildAwareness: Boolean(parentIncidentKey),
    recoveryOf: recovery ? incidentKey : null,
  };
}
