import {
  normalizeSignal,
  type NormalizedSignal,
  type SignalEvidence,
  type SignalSeverity,
} from "../contracts/operationalSignal";

export type AwarenessKind =
  | "operational"
  | "infrastructure"
  | "security"
  | "maintenance"
  | "financial"
  | "community"
  | "environmental"
  | "service"
  | "visitor"
  | "executive";

export type AwarenessUrgency = "monitor" | "review" | "act" | "urgent";

export type OperationalContext = {
  estate?: Record<string, unknown> | null;
  building?: Record<string, unknown> | null;
  unit?: Record<string, unknown> | null;
  room?: Record<string, unknown> | null;
  occupancy?: Record<string, unknown> | null;
  schedule?: Record<string, unknown> | null;
  ownership?: Record<string, unknown> | null;
  policies?: Record<string, unknown> | null;
  history?: Record<string, unknown> | null;
  asset?: Record<string, unknown> | null;
  environment?: Record<string, unknown> | null;
  maintenance?: Record<string, unknown> | null;
  visitor?: Record<string, unknown> | null;
  security?: Record<string, unknown> | null;
  financial?: Record<string, unknown> | null;
  weather?: Record<string, unknown> | null;
  edgeState?: Record<string, unknown> | null;
  deviceHealth?: Record<string, unknown> | null;
  signalHistory?: NormalizedSignal[];
};

export type OperationalAwareness = {
  id: string;
  kind: AwarenessKind;
  title: string;
  summary: string;
  reason: string;
  impact: string;
  urgency: AwarenessUrgency;
  owner: string;
  recommended_action: string;
  verification: string;
  supporting_evidence: SignalEvidence[];
  related_signals: string[];
  related_executions: string[];
  executionReference: string | null;
  confidence: number;
  generated_at: string;
  context: OperationalContext;
};

function text(value: unknown, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function ageLabel(timestamp: string) {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "recently";
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function awarenessKind(signal: NormalizedSignal): AwarenessKind {
  const haystack = lower(`${signal.type} ${signal.source} ${signal.domain} ${signal.entity.type}`);
  if (/visitor|gate|access/.test(haystack)) return "visitor";
  if (/security|lock|camera|incident/.test(haystack)) return "security";
  if (/wallet|financial|payment|accounting|transaction/.test(haystack)) return "financial";
  if (/maintenance|support|work.?order/.test(haystack)) return "maintenance";
  if (/community|announcement|post|moderation/.test(haystack)) return "community";
  if (/environment|weather|air|waste|humidity|temperature|water|utility|energy/.test(haystack)) return "environmental";
  if (/service/.test(haystack)) return "service";
  if (/device|edge|telemetry|meter|infrastructure|provider|onvif|tuya|mqtt|ble|matter/.test(haystack)) return "infrastructure";
  return "operational";
}

function urgencyFrom(severity: SignalSeverity, confidence: number): AwarenessUrgency {
  if (severity === "critical" && confidence >= 0.65) return "urgent";
  if (severity === "critical" || severity === "warning") return "act";
  if (severity === "attention") return "review";
  return "monitor";
}

function ownerFrom(signal: NormalizedSignal, context: OperationalContext) {
  return (
    text(signal.actor.name || signal.actor.role) ||
    text(context.ownership?.owner || context.ownership?.assignee || context.asset?.owner) ||
    "Operational owner"
  );
}

function entityLabel(signal: NormalizedSignal) {
  return text(signal.entity.name || signal.entity.id || signal.domain, "Operational item");
}

function infrastructureEventKind(signal: NormalizedSignal) {
  return text(signal.metadata.infrastructure_event_kind || signal.metadata.infrastructureEventKind);
}

function isInfrastructureRecovery(kind: string) {
  return /restored|recovered|stopped/.test(kind);
}

function infrastructureTitle(kind: string) {
  switch (kind) {
    case "power_outage":
      return "Power appears to have been lost";
    case "power_restored":
      return "Grid power appears to be restored";
    case "internet_outage":
      return "Internet connectivity appears interrupted";
    case "internet_restored":
      return "Internet connection has recovered";
    case "provider_unavailable":
      return "The provider cloud is currently unreachable";
    case "provider_recovered":
      return "The device provider is reachable again";
    case "hub_disconnected":
      return "Your smart hub appears offline";
    case "hub_reconnected":
      return "Your smart hub is back online";
    case "zigbee_coordinator_offline":
      return "The Zigbee hub appears offline";
    case "zigbee_coordinator_recovered":
      return "The Zigbee hub is reporting again";
    case "bluetooth_gateway_unavailable":
      return "The Bluetooth gateway appears unavailable";
    case "bluetooth_gateway_recovered":
      return "The Bluetooth gateway is back online";
    case "mesh_node_offline":
      return "A mesh node appears to be offline";
    case "mesh_node_recovered":
      return "The mesh node is back online";
    case "mass_device_offline":
      return "Several connected devices went offline together";
    case "mass_device_recovery":
      return "Several connected devices recovered together";
    case "generator_started":
      return "Generator backup started";
    case "generator_stopped":
      return "Generator backup stopped";
    case "inverter_takeover":
      return "Inverter backup appears active";
    case "solar_takeover":
      return "Solar or battery power appears active";
    default:
      return "";
  }
}

function locationLabel(signal: NormalizedSignal, context: OperationalContext) {
  return text(signal.room.name || context.room?.name || context.unit?.name || context.building?.name || signal.building.name || signal.estate.name);
}

function titleFor(kind: AwarenessKind) {
  return {
    operational: "Operational Attention",
    infrastructure: "Infrastructure Attention",
    security: "Security Attention",
    maintenance: "Maintenance Attention",
    financial: "Financial Attention",
    community: "Community Attention",
    environmental: "Environmental Attention",
    service: "Service Attention",
    visitor: "Visitor Attention",
    executive: "Executive Attention",
  }[kind];
}

function recommendedAction(kind: AwarenessKind, signal: NormalizedSignal) {
  const infrastructureKind = infrastructureEventKind(signal);
  if (kind === "infrastructure" && infrastructureKind) {
    if (/power_outage/.test(infrastructureKind)) return "Check estate or home power, generator state, and network equipment.";
    if (/internet_outage/.test(infrastructureKind)) return "Check the router, ISP link, and Wi-Fi power.";
    if (/provider_unavailable/.test(infrastructureKind)) return "Wait for provider recovery or retry once provider health improves.";
    if (/hub|mesh|zigbee|bluetooth/.test(infrastructureKind)) return "Check the affected hub or gateway power and uplink.";
    if (/restored|recovered/.test(infrastructureKind)) return "Review any device that did not recover automatically.";
  }
  const status = lower(signal.entity.status || signal.metadata.status || signal.metadata.state);
  if (/offline|unreachable|disconnected/.test(status)) return "Verify power or network connectivity.";
  if (/failed|error/.test(status)) return "Review evidence and confirm the safest recovery path.";
  if (/overdue|blocked|escalated/.test(status)) return "Assign ownership and verify the next lifecycle action.";
  if (kind === "visitor") return "Review access state and verify the visitor lifecycle.";
  if (kind === "financial") return "Review the transaction trail and reconcile the affected account.";
  if (kind === "security") return "Verify the security evidence and assign response ownership.";
  if (kind === "maintenance") return "Review maintenance ownership, schedule, and resident impact.";
  return "Review supporting evidence and assign the next operational owner.";
}

function impactFor(kind: AwarenessKind, signal: NormalizedSignal) {
  const infrastructureKind = infrastructureEventKind(signal);
  if (kind === "infrastructure" && infrastructureKind) {
    if (/power_outage/.test(infrastructureKind)) return "Power-dependent devices, automations, and connectivity may remain unavailable until supply is restored.";
    if (/internet_outage|provider_unavailable/.test(infrastructureKind)) return "Cloud-controlled devices and provider acknowledgements may be delayed until connectivity returns.";
    if (/hub|mesh|zigbee|bluetooth/.test(infrastructureKind)) return "Dependent sensors, remotes, and child devices may stop reporting until the gateway reconnects.";
    if (isInfrastructureRecovery(infrastructureKind)) return "Most affected services appear to be recovering, but any remaining unavailable device still needs review.";
  }
  const status = lower(signal.entity.status || signal.metadata.status || signal.metadata.state);
  if (/offline|unreachable|disconnected/.test(status) && kind === "infrastructure") {
    return "Automations, monitoring, or resident-facing operations depending on this asset may not execute.";
  }
  if (kind === "security") return "Access, safety, or incident response posture may be affected.";
  if (kind === "visitor") return "Visitor access continuity or gate verification may be affected.";
  if (kind === "financial") return "Balances, payments, reconciliation, or resident service access may be affected.";
  if (kind === "maintenance") return "Resident continuity, SLA posture, or repair ownership may be affected.";
  if (kind === "environmental") return "Comfort, safety, or environmental readiness may be affected.";
  return "Operational continuity may be affected until this signal is reviewed.";
}

function summaryFor(kind: AwarenessKind, signal: NormalizedSignal, context: OperationalContext) {
  const infrastructureKind = infrastructureEventKind(signal);
  if (kind === "infrastructure" && infrastructureKind) {
    const affectedCount = Number(signal.metadata.affected_device_count || 0);
    const recoveredCount = Number(signal.metadata.recovered_count || affectedCount || 0);
    const stillAffectedCount = Number(signal.metadata.still_affected_count || 0);
    const provider = text(signal.metadata.provider);
    const durationMinutes = Number(signal.metadata.duration_minutes || 0);
    const duration = Number.isFinite(durationMinutes) && durationMinutes > 0
      ? ` after about ${durationMinutes} minute${durationMinutes === 1 ? "" : "s"}`
      : "";
    if (infrastructureKind === "power_outage") {
      return `It looks like power was lost. ${affectedCount || "Several"} connected device${affectedCount === 1 ? "" : "s"} became unavailable at the same time.`;
    }
    if (infrastructureKind === "power_restored") {
      return `Grid power appears to be back. ${recoveredCount || "Several"} device${recoveredCount === 1 ? "" : "s"} recovered${duration}${stillAffectedCount ? `, while ${stillAffectedCount} still need attention` : ""}.`;
    }
    if (infrastructureKind === "internet_outage") {
      return `It appears your home Wi-Fi or internet is offline. ${affectedCount || "Several"} cloud-controlled device${affectedCount === 1 ? "" : "s"} cannot currently be reached.`;
    }
    if (infrastructureKind === "internet_restored") {
      return `Internet connectivity appears restored. ${recoveredCount || "Several"} device${recoveredCount === 1 ? "" : "s"} resumed reporting${duration}${stillAffectedCount ? `, with ${stillAffectedCount} still unavailable` : ""}.`;
    }
    if (infrastructureKind === "provider_unavailable") {
      return `The connected device provider${provider ? ` (${provider})` : ""} appears unreachable. ${affectedCount || "Several"} device${affectedCount === 1 ? "" : "s"} stopped responding together.`;
    }
    if (infrastructureKind === "provider_recovered") {
      return `The device provider is reachable again. ${recoveredCount || "Several"} device${recoveredCount === 1 ? "" : "s"} resumed reporting${duration}.`;
    }
    if (/hub_disconnected|zigbee_coordinator_offline|bluetooth_gateway_unavailable|mesh_node_offline/.test(infrastructureKind)) {
      return `${infrastructureTitle(infrastructureKind)}. ${affectedCount || "Several"} dependent device${affectedCount === 1 ? "" : "s"} may temporarily stop reporting.`;
    }
    if (/hub_reconnected|zigbee_coordinator_recovered|bluetooth_gateway_recovered|mesh_node_recovered/.test(infrastructureKind)) {
      return `${infrastructureTitle(infrastructureKind)}. ${recoveredCount || "Several"} dependent device${recoveredCount === 1 ? "" : "s"} resumed reporting${duration}${stillAffectedCount ? `, while ${stillAffectedCount} still need attention` : ""}.`;
    }
    if (infrastructureKind === "mass_device_offline") {
      return `${affectedCount || "Several"} connected devices went offline together. Oyi is treating this as one shared infrastructure event instead of separate failures.`;
    }
    if (infrastructureKind === "mass_device_recovery") {
      return `${recoveredCount || "Several"} connected devices recovered together${duration}${stillAffectedCount ? `, while ${stillAffectedCount} still need review` : ""}.`;
    }
    if (infrastructureKind === "generator_started") return "Backup generation appears to have taken over.";
    if (infrastructureKind === "generator_stopped") return "Backup generation is no longer active.";
    if (infrastructureKind === "inverter_takeover") return "Battery or inverter power appears to have taken over connected loads.";
    if (infrastructureKind === "solar_takeover") return "A solar or battery source appears to be supporting connected loads.";
  }
  const entity = entityLabel(signal);
  const location = locationLabel(signal, context);
  const status = lower(signal.entity.status || signal.metadata.status || signal.metadata.state);
  if (/offline|unreachable|disconnected/.test(status)) {
    return `${location ? `${location} ` : ""}${entity} has remained offline for ${ageLabel(signal.timestamp)}.`;
  }
  if (/failed|error/.test(status)) {
    return `${entity} is reporting a failure state${location ? ` in ${location}` : ""}.`;
  }
  if (/overdue|blocked|escalated/.test(status)) {
    return `${entity} requires ownership review because its lifecycle is ${status}.`;
  }
  return `${entity} generated ${titleFor(kind).toLowerCase()} from ${text(signal.source, "Oyi")}.`;
}

export function buildOperationalContext(signals: NormalizedSignal[], seed: OperationalContext = {}): OperationalContext {
  const latest = signals[0];
  return {
    estate: seed.estate || record(latest?.estate),
    building: seed.building || record(latest?.building),
    unit: seed.unit || record(latest?.context.unit),
    room: seed.room || record(latest?.room),
    occupancy: seed.occupancy || record(latest?.context.occupancy),
    schedule: seed.schedule || record(latest?.context.schedule),
    ownership: seed.ownership || record(latest?.context.ownership),
    policies: seed.policies || record(latest?.context.policies),
    history: seed.history || record(latest?.context.history),
    asset: seed.asset || record(latest?.context.asset || latest?.entity),
    environment: seed.environment || record(latest?.context.environment),
    maintenance: seed.maintenance || record(latest?.context.maintenance),
    visitor: seed.visitor || record(latest?.context.visitor),
    security: seed.security || record(latest?.context.security),
    financial: seed.financial || record(latest?.context.financial),
    weather: seed.weather || record(latest?.context.weather),
    edgeState: seed.edgeState || record(latest?.context.edgeState || latest?.context.edge_state),
    deviceHealth: seed.deviceHealth || record(latest?.context.deviceHealth || latest?.context.device_health),
    signalHistory: seed.signalHistory || signals,
  };
}

export function buildAwarenessFromSignal(input: Partial<NormalizedSignal> & Record<string, unknown>, seed: OperationalContext = {}): OperationalAwareness {
  const signal = normalizeSignal(input);
  const context = buildOperationalContext([signal, ...(seed.signalHistory || [])], seed);
  const kind = awarenessKind(signal);
  const urgency = urgencyFrom(signal.severity, signal.confidence);
  const generatedAt = new Date().toISOString();
  const specificInfrastructureTitle = kind === "infrastructure" ? infrastructureTitle(infrastructureEventKind(signal)) : "";
  return {
    id: `awareness:${signal.id}`,
    kind,
    title: specificInfrastructureTitle || titleFor(kind),
    summary: summaryFor(kind, signal, context),
    reason: text(signal.metadata.reason || signal.metadata.message || signal.metadata.description || signal.entity.status, "A normalized signal requires operational review."),
    impact: impactFor(kind, signal),
    urgency,
    owner: ownerFrom(signal, context),
    recommended_action: recommendedAction(kind, signal),
    verification: urgency === "monitor" ? "Monitor for recurrence." : "Verify with supporting evidence before closure.",
    supporting_evidence: signal.evidence.length
      ? signal.evidence
      : [
          {
            id: `${signal.id}:source`,
            type: signal.type,
            source: signal.source,
            summary: text(signal.metadata.summary || signal.metadata.message || signal.entity.status || "Normalized operational signal"),
            timestamp: signal.timestamp,
            metadata: signal.metadata,
          },
        ],
    related_signals: [signal.id],
    related_executions: [text(signal.metadata.execution_id || signal.metadata.executionId || signal.runtimeId)].filter(Boolean),
    executionReference: text(signal.metadata.execution_id || signal.metadata.executionId || signal.runtimeId) || null,
    confidence: signal.confidence,
    generated_at: generatedAt,
    context,
  };
}

export function buildAwareness(signals: Array<Partial<NormalizedSignal> & Record<string, unknown>>, seed: OperationalContext = {}) {
  const awareness = signals.map((signal) => buildAwarenessFromSignal(signal, seed));
  const unique = new Map<string, OperationalAwareness>();
  const rank = (item: OperationalAwareness) => ({ urgent: 0, act: 1, review: 2, monitor: 3 }[item.urgency] * 10 - item.confidence);
  for (const item of awareness.sort((a, b) => rank(a) - rank(b))) {
    const key = `${item.kind}:${item.summary}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}
