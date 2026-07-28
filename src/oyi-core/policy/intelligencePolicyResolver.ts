import type { NormalizedSignal } from "../contracts/operationalSignal";
import type { SignalRuntimeOutput } from "../runtime/universalSignalRuntime";
import type { RuntimeChannel, RuntimePayloadKind } from "../runtime/runtimeSubscriptions";

export type IntelligenceSurface = "consumer" | "facility" | "office";
export type IntelligencePrivacyClass =
  | "resident_device_private"
  | "smart_access_private"
  | "home_private"
  | "home_shared"
  | "building_operational"
  | "building_security"
  | "building_financial"
  | "organization_restricted"
  | "public_community";

export type IntelligencePolicyDecision = {
  privacyClass: IntelligencePrivacyClass;
  allowedOutputs: SignalRuntimeOutput[];
  deniedOutputs: SignalRuntimeOutput[];
  allowedChannels: RuntimeChannel[];
  redaction: "none" | "summary_only" | "private_evidence_removed";
  facilityProjectionPermitted: boolean;
  executiveAggregationPermitted: boolean;
  notificationPermitted: boolean;
  reason: string;
};

const ALL_OUTPUTS: SignalRuntimeOutput[] = [
  "operational_intelligence",
  "infrastructure_registry",
  "activity",
  "notifications",
  "automation",
  "conversation",
  "digital_twin",
  "reports",
  "executive_intelligence",
  "future_ai",
];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function metadata(signal: NormalizedSignal) {
  return signal.metadata || {};
}

export function homeIdFromSignal(signal: NormalizedSignal) {
  return (
    text(metadata(signal).home_id || metadata(signal).homeId || signal.context?.home_id || signal.context?.homeId) ||
    null
  );
}

export function privacyClassForSignal(signal: NormalizedSignal): IntelligencePrivacyClass {
  const explicit = lower(metadata(signal).privacy_class || metadata(signal).privacyClass || signal.context?.privacy_class);
  if (explicit === "resident_device_private" || explicit === "smart_access_private" || explicit === "home_private" || explicit === "home_shared" || explicit === "building_operational" || explicit === "building_security" || explicit === "building_financial" || explicit === "organization_restricted" || explicit === "public_community") {
    return explicit;
  }
  const domain = lower(signal.domain);
  const ownership = lower(metadata(signal).ownership_class || metadata(signal).ownershipClass || signal.context?.ownership_class);
  const projection = lower(metadata(signal).projection_policy || metadata(signal).projectionPolicy || signal.context?.projection_policy);
  const haystack = lower(`${signal.type} ${signal.source} ${signal.domain} ${signal.entity.type} ${signal.entity.name}`);
  if (domain === "smart_access_private" || /smart.?access|private.?lock|credential|pin|fingerprint|card/.test(haystack)) return "smart_access_private";
  if (domain === "resident_device_private" || ownership === "resident_owned" || projection === "consumer_private" || (homeIdFromSignal(signal) && /device|tuya|mqtt|matter|ble|switch|light|socket|tv|ir|lock/.test(haystack))) return "resident_device_private";
  if (/wallet|payment|financial|balance/.test(haystack)) return "home_private";
  if (/camera|security|access|alarm/.test(haystack)) return "building_security";
  if (/infrastructure|meter|utility|edge|gateway|generator|water|power|internet|facility/.test(haystack)) return "building_operational";
  if (/community|announcement/.test(haystack)) return "public_community";
  return signal.buildingId ? "building_operational" : homeIdFromSignal(signal) ? "home_private" : "organization_restricted";
}

function outputSetFor(signal: NormalizedSignal, privacyClass: IntelligencePrivacyClass) {
  if (privacyClass === "resident_device_private") {
    return signal.severity === "critical" || signal.severity === "warning"
      ? new Set<SignalRuntimeOutput>(["activity", "notifications", "conversation"])
      : new Set<SignalRuntimeOutput>(["activity", "conversation"]);
  }
  if (privacyClass === "smart_access_private") {
    return signal.severity === "critical" || signal.severity === "warning"
      ? new Set<SignalRuntimeOutput>(["activity", "notifications", "conversation"])
      : new Set<SignalRuntimeOutput>(["activity", "conversation"]);
  }
  if (privacyClass === "home_private" || privacyClass === "home_shared") {
    return new Set<SignalRuntimeOutput>(["operational_intelligence", "activity", "notifications", "conversation"]);
  }
  if (privacyClass === "building_operational" || privacyClass === "building_security" || privacyClass === "building_financial") {
    const outputs = new Set<SignalRuntimeOutput>(["operational_intelligence", "infrastructure_registry", "activity", "notifications", "automation", "conversation", "digital_twin", "reports", "executive_intelligence"]);
    if (signal.severity === "info") outputs.delete("notifications");
    return outputs;
  }
  if (privacyClass === "public_community") {
    return new Set<SignalRuntimeOutput>(["operational_intelligence", "activity", "notifications", "conversation", "reports"]);
  }
  return new Set<SignalRuntimeOutput>(["operational_intelligence", "conversation", "executive_intelligence"]);
}

function channelsForOutput(output: SignalRuntimeOutput, kind: RuntimePayloadKind, privacyClass: IntelligencePrivacyClass): RuntimeChannel[] {
  const consumerKind = `consumer:${kind}` as RuntimeChannel;
  const facilityKind = `facility:${kind}` as RuntimeChannel;
  const officeKind = `office:${kind}` as RuntimeChannel;
  const privateConsumer = privacyClass === "resident_device_private" || privacyClass === "smart_access_private" || privacyClass === "home_private";
  if (output === "activity") return ["activity:event", privateConsumer ? consumerKind : facilityKind].filter(Boolean) as RuntimeChannel[];
  if (output === "notifications") return ["notification:event", privateConsumer ? consumerKind : facilityKind].filter(Boolean) as RuntimeChannel[];
  if (output === "conversation") return ["future:conversation", privateConsumer ? consumerKind : facilityKind].filter(Boolean) as RuntimeChannel[];
  if (output === "operational_intelligence") return privateConsumer ? [consumerKind] : [facilityKind, officeKind].filter((item) => item.includes(`:${kind}`)) as RuntimeChannel[];
  if (output === "automation") return privateConsumer ? [consumerKind] : [facilityKind, officeKind].filter((item) => item.includes(`:${kind}`)) as RuntimeChannel[];
  if (output === "infrastructure_registry" || output === "digital_twin") return privateConsumer ? [] : ["future:digital-twin", facilityKind].filter((item) => item.includes(`:${kind}`) || item === "future:digital-twin") as RuntimeChannel[];
  if (output === "reports" || output === "executive_intelligence") return privateConsumer ? [] : ["future:executive", officeKind].filter((item) => item.includes(`:${kind}`) || item === "future:executive") as RuntimeChannel[];
  return [];
}

export function resolveIntelligencePolicy(signal: NormalizedSignal): IntelligencePolicyDecision {
  const privacyClass = privacyClassForSignal(signal);
  const allowed = outputSetFor(signal, privacyClass);
  const allowedOutputs = ALL_OUTPUTS.filter((output) => allowed.has(output));
  const deniedOutputs = ALL_OUTPUTS.filter((output) => !allowed.has(output));
  const privateScope = privacyClass === "resident_device_private" || privacyClass === "smart_access_private" || privacyClass === "home_private";
  return {
    privacyClass,
    allowedOutputs,
    deniedOutputs,
    allowedChannels: [],
    redaction: privateScope ? "private_evidence_removed" : "summary_only",
    facilityProjectionPermitted: !privateScope,
    executiveAggregationPermitted: !privateScope,
    notificationPermitted: allowed.has("notifications"),
    reason: privateScope ? "home_or_resident_private_scope" : "building_or_organization_operational_scope",
  };
}

export function channelsForRuntimeDelivery(signal: NormalizedSignal | undefined, outputs: SignalRuntimeOutput[] | undefined, kind: RuntimePayloadKind, fallback: RuntimeChannel[]): RuntimeChannel[] {
  if (!signal || !outputs?.length) return fallback;
  const privacyClass = privacyClassForSignal(signal);
  const channels = new Set<RuntimeChannel>();
  for (const output of outputs) {
    for (const channel of channelsForOutput(output, kind, privacyClass)) channels.add(channel);
  }
  if (kind === "conversation") channels.add("conversation:response");
  if (kind === "executive" && !["resident_device_private", "smart_access_private", "home_private"].includes(privacyClass)) channels.add("executive:briefing");
  return [...channels];
}
