import type { NormalizedSignal, SignalEvidence, SignalSeverity } from "../contracts/operationalSignal";
import { normalizeSignal } from "../contracts/operationalSignal";
import {
  buildAwareness,
  type OperationalAwareness,
  type OperationalContext,
} from "./contextAwareness";

export type OperationalInsightDomain =
  | "security"
  | "infrastructure"
  | "utility"
  | "maintenance"
  | "visitor"
  | "environmental"
  | "financial"
  | "community";

export type OperationalInsight = {
  id: string;
  title: string;
  summary: string;
  domain: OperationalInsightDomain;
  severity: SignalSeverity;
  confidence: number;
  reason: string;
  impact: string;
  recommendedAction: string;
  evidence: SignalEvidence[];
  relatedSignals: string[];
  relatedAwareness: string[];
  generatedAt: string;
  owner: string;
  verification: string;
  nextStep: string;
  source: "operational_reasoning_runtime";
};

export type ReasoningInput = {
  signals: Array<Partial<NormalizedSignal> & Record<string, unknown>>;
  awareness?: OperationalAwareness[];
  context?: OperationalContext;
  signalHistory?: Array<Partial<NormalizedSignal> & Record<string, unknown>>;
  attention?: Array<{ id?: string; title?: string; detail?: string; domain?: string; severity?: string; action?: string }>;
  generatedAt?: string;
};

type InsightCandidate = Omit<OperationalInsight, "id" | "source"> & { entityKey: string };

function text(value: unknown, fallback = "") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function timeMs(value?: string) {
  const parsed = new Date(String(value || "")).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function severityRank(value: SignalSeverity) {
  return { critical: 3, warning: 2, attention: 1, info: 0 }[value];
}

function dominantSeverity(values: SignalSeverity[]) {
  return [...values].sort((a, b) => severityRank(b) - severityRank(a))[0] || "info";
}

function confidence(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0.65;
  return Math.max(0, Math.min(1, valid.reduce((sum, value) => sum + value, 0) / valid.length));
}

function entityKey(signal: NormalizedSignal) {
  return [
    lower(signal.domain || signal.type),
    lower(signal.entity.id || signal.entity.name || "unknown"),
    lower(signal.room.id || signal.building.id || signal.estate.id || "scope"),
  ].join(":");
}

function signalStatus(signal: NormalizedSignal) {
  return lower(signal.entity.status || signal.metadata.status || signal.metadata.state || signal.metadata.health_status);
}

function relatedAwarenessFor(signal: NormalizedSignal, awareness: OperationalAwareness[]) {
  return awareness.filter((item) => item.related_signals.includes(signal.id));
}

function activeSignals(history: NormalizedSignal[], signal: NormalizedSignal, windowMs: number) {
  const latestTs = timeMs(signal.timestamp);
  return history.filter((item) => entityKey(item) === entityKey(signal) && Math.abs(latestTs - timeMs(item.timestamp)) <= windowMs);
}

function shouldReason(signals: NormalizedSignal[], awareness: OperationalAwareness[]) {
  const severe = signals.some((signal) => signal.severity === "critical");
  const repeated = signals.length >= 2;
  const strongAwareness = awareness.some((item) => item.urgency === "urgent" || item.urgency === "act" || item.confidence >= 0.8);
  return severe || repeated || strongAwareness;
}

function mergeEvidence(signals: NormalizedSignal[], awareness: OperationalAwareness[]) {
  const unique = new Map<string, SignalEvidence>();
  for (const item of signals.flatMap((signal) => signal.evidence)) {
    const key = text(item.id || `${item.type}:${item.timestamp}:${item.summary}`);
    if (!unique.has(key)) unique.set(key, item);
  }
  for (const item of awareness.flatMap((entry) => entry.supporting_evidence)) {
    const key = text(item.id || `${item.type}:${item.timestamp}:${item.summary}`);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, 6);
}

function ownerFrom(signals: NormalizedSignal[], awareness: OperationalAwareness[]) {
  return (
    awareness.find((item) => text(item.owner))?.owner ||
    signals.find((signal) => text(signal.actor.name || signal.actor.role))?.actor.name ||
    signals.find((signal) => text(signal.actor.role))?.actor.role ||
    "Operational owner"
  );
}

function candidateFor(
  domain: OperationalInsightDomain,
  signal: NormalizedSignal,
  signals: NormalizedSignal[],
  awareness: OperationalAwareness[],
  generatedAt: string
): InsightCandidate | null {
  if (!shouldReason(signals, awareness)) return null;
  const entity = text(signal.entity.name || signal.entity.id, "Operational entity");
  const reasons: Record<OperationalInsightDomain, Omit<InsightCandidate, "entityKey">> = {
    security: {
      title: "Potential Security Exposure",
      summary: `${entity} requires security review.`,
      domain,
      severity: dominantSeverity(signals.map((item) => item.severity)),
      confidence: confidence([...signals.map((item) => item.confidence), ...awareness.map((item) => item.confidence)]),
      reason: "Security-related signals show elevated operational exposure.",
      impact: "Access control, incident response, or evidence capture may be degraded until verified.",
      recommendedAction: "Verify door, visitor, and camera evidence together before closure.",
      evidence: mergeEvidence(signals, awareness),
      relatedSignals: signals.map((item) => item.id),
      relatedAwareness: awareness.map((item) => item.id),
      generatedAt,
      owner: ownerFrom(signals, awareness),
      verification: "Confirm access logs, camera coverage, and operator assignment.",
      nextStep: "Route to Security Command if exposure remains active.",
    },
    infrastructure: {
      title: "Infrastructure Reliability Issue",
      summary: `${entity} is showing repeated availability or execution failure signals.`,
      domain,
      severity: dominantSeverity(signals.map((item) => item.severity)),
      confidence: confidence([...signals.map((item) => item.confidence), ...awareness.map((item) => item.confidence)]),
      reason: "The same infrastructure entity has repeated offline, failed, or degraded state signals within the active window.",
      impact: "Automations, telemetry continuity, or resident-facing controls may not execute reliably.",
      recommendedAction: "Verify connectivity, power state, and adapter health before escalating dispatch.",
      evidence: mergeEvidence(signals, awareness),
      relatedSignals: signals.map((item) => item.id),
      relatedAwareness: awareness.map((item) => item.id),
      generatedAt,
      owner: ownerFrom(signals, awareness),
      verification: "Confirm last-seen time, command success rate, and adapter availability.",
      nextStep: "Escalate to Infrastructure Registry ownership if instability persists.",
    },
    utility: {
      title: "Utility Continuity Risk",
      summary: `${entity} is reporting a pattern that can affect cost or continuity.`,
      domain,
      severity: dominantSeverity(signals.map((item) => item.severity)),
      confidence: confidence([...signals.map((item) => item.confidence), ...awareness.map((item) => item.confidence)]),
      reason: "Utility telemetry shows elevated operational variance or degraded supply posture.",
      impact: "Energy cost, backup posture, or service continuity may drift before operators intervene.",
      recommendedAction: "Review utility telemetry, backup state, and recent source changes together.",
      evidence: mergeEvidence(signals, awareness),
      relatedSignals: signals.map((item) => item.id),
      relatedAwareness: awareness.map((item) => item.id),
      generatedAt,
      owner: ownerFrom(signals, awareness),
      verification: "Validate meter evidence, power state, and backup source posture.",
      nextStep: "Route to Utility Intelligence if the pattern remains active.",
    },
    maintenance: {
      title: "Preventive Maintenance Candidate",
      summary: `${entity} is showing a repeat pattern that may require maintenance follow-up.`,
      domain,
      severity: dominantSeverity(signals.map((item) => item.severity)),
      confidence: confidence([...signals.map((item) => item.confidence), ...awareness.map((item) => item.confidence)]),
      reason: "Repeated failure signals align with maintenance-related risk or overdue ownership.",
      impact: "Resident continuity, SLA posture, or repair backlog may degrade if the issue persists.",
      recommendedAction: "Schedule preventive inspection and confirm current maintenance ownership.",
      evidence: mergeEvidence(signals, awareness),
      relatedSignals: signals.map((item) => item.id),
      relatedAwareness: awareness.map((item) => item.id),
      generatedAt,
      owner: ownerFrom(signals, awareness),
      verification: "Review prior repairs, backlog state, and the most recent operational evidence.",
      nextStep: "Create or update the maintenance continuity workflow.",
    },
    visitor: {
      title: "Access Review Required",
      summary: `${entity} is part of a visitor or access pattern requiring review.`,
      domain,
      severity: dominantSeverity(signals.map((item) => item.severity)),
      confidence: confidence([...signals.map((item) => item.confidence), ...awareness.map((item) => item.confidence)]),
      reason: "Visitor or access signals show repeated denial, verification mismatch, or unusual activity.",
      impact: "Visitor continuity, gate trust, or access verification may be affected.",
      recommendedAction: "Review access evidence, visitor identity, and current queue ownership.",
      evidence: mergeEvidence(signals, awareness),
      relatedSignals: signals.map((item) => item.id),
      relatedAwareness: awareness.map((item) => item.id),
      generatedAt,
      owner: ownerFrom(signals, awareness),
      verification: "Confirm the access trail and the active approval lifecycle.",
      nextStep: "Route to the Visitor Access Registry review queue.",
    },
    environmental: {
      title: "Environmental Comfort Risk",
      summary: `${entity} is part of an environmental pattern that may affect occupant readiness.`,
      domain,
      severity: dominantSeverity(signals.map((item) => item.severity)),
      confidence: confidence([...signals.map((item) => item.confidence), ...awareness.map((item) => item.confidence)]),
      reason: "Environmental readings and supporting signals indicate a comfort or safety exposure.",
      impact: "Comfort, safety, or environmental readiness may degrade without intervention.",
      recommendedAction: "Verify the climate device, sensor health, and occupancy context together.",
      evidence: mergeEvidence(signals, awareness),
      relatedSignals: signals.map((item) => item.id),
      relatedAwareness: awareness.map((item) => item.id),
      generatedAt,
      owner: ownerFrom(signals, awareness),
      verification: "Confirm sensor validity and current environmental conditions.",
      nextStep: "Escalate to Environmental Awareness if the condition persists.",
    },
    financial: {
      title: "Financial Posture Attention",
      summary: `${entity} is part of a financial pattern requiring operational review.`,
      domain,
      severity: dominantSeverity(signals.map((item) => item.severity)),
      confidence: confidence([...signals.map((item) => item.confidence), ...awareness.map((item) => item.confidence)]),
      reason: "Collection, billing, or service demand signals indicate a posture drift.",
      impact: "Collections, reconciliation, or service continuity may be affected if the pattern grows.",
      recommendedAction: "Review the transaction trail, outstanding balances, and demand changes together.",
      evidence: mergeEvidence(signals, awareness),
      relatedSignals: signals.map((item) => item.id),
      relatedAwareness: awareness.map((item) => item.id),
      generatedAt,
      owner: ownerFrom(signals, awareness),
      verification: "Confirm the ledger evidence and the affected account state.",
      nextStep: "Route to Financial Posture review.",
    },
    community: {
      title: "Resident Experience Risk",
      summary: `${entity} is part of a community pattern that may require response ownership.`,
      domain,
      severity: dominantSeverity(signals.map((item) => item.severity)),
      confidence: confidence([...signals.map((item) => item.confidence), ...awareness.map((item) => item.confidence)]),
      reason: "Community signals align with unresolved operational friction in the same zone or workflow.",
      impact: "Resident trust or community stability may degrade if the linked issue remains unresolved.",
      recommendedAction: "Link the community signal to its operational cause and assign response ownership.",
      evidence: mergeEvidence(signals, awareness),
      relatedSignals: signals.map((item) => item.id),
      relatedAwareness: awareness.map((item) => item.id),
      generatedAt,
      owner: ownerFrom(signals, awareness),
      verification: "Review complaints, linked operations, and recency of similar issues.",
      nextStep: "Route to Community Signals follow-up.",
    },
  };
  return { ...reasons[domain], entityKey: entityKey(signal) };
}

function inferDomain(signal: NormalizedSignal): OperationalInsightDomain | null {
  const haystack = lower(`${signal.type} ${signal.source} ${signal.domain} ${signal.entity.type} ${JSON.stringify(signal.metadata)}`);
  if (/security|access|visitor|gate|camera|lock|incident|door/.test(haystack)) return /visitor/.test(haystack) ? "visitor" : "security";
  if (/device|edge|telemetry|meter|infrastructure|camera|tuya|matter|mqtt|ble|onvif/.test(haystack)) return "infrastructure";
  if (/utility|power|energy|solar|generator|water/.test(haystack)) return "utility";
  if (/maintenance|repair|support|work.?order/.test(haystack)) return "maintenance";
  if (/environment|sensor|temperature|humidity|climate|air/.test(haystack)) return "environmental";
  if (/wallet|financial|payment|accounting|billing|collection/.test(haystack)) return "financial";
  if (/community|complaint|moderation|announcement|resident/.test(haystack)) return "community";
  return null;
}

export class OperationalReasoningRuntime {
  constructor(private options: { historyLimit?: number; dedupeWindowMs?: number } = {}) {}

  evaluate(input: ReasoningInput): OperationalInsight[] {
    const generatedAt = input.generatedAt || new Date().toISOString();
    const signals = input.signals.map((item) => normalizeSignal(item)).sort((a, b) => timeMs(b.timestamp) - timeMs(a.timestamp));
    const awareness = input.awareness?.length ? input.awareness : buildAwareness(signals, input.context);
    const history = [...signals, ...(input.signalHistory || []).map((item) => normalizeSignal(item))].slice(0, this.options.historyLimit ?? 80);
    const candidates: InsightCandidate[] = [];

    for (const signal of signals) {
      const domain = inferDomain(signal);
      if (!domain) continue;
      const relatedSignals = activeSignals(history, signal, this.options.dedupeWindowMs ?? 1000 * 60 * 60 * 6);
      const relatedAwareness = relatedAwarenessFor(signal, awareness);
      const candidate = candidateFor(domain, signal, relatedSignals, relatedAwareness, generatedAt);
      if (candidate) candidates.push(candidate);
    }

    const unique = new Map<string, InsightCandidate>();
    for (const candidate of candidates) {
      const key = `${candidate.domain}:${candidate.entityKey}:${lower(candidate.reason)}`;
      const current = unique.get(key);
      if (!current || severityRank(candidate.severity) > severityRank(current.severity) || candidate.confidence > current.confidence) {
        unique.set(key, candidate);
      }
    }

    return [...unique.values()]
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence)
      .map((candidate, index) => ({
        id: `insight:${candidate.domain}:${candidate.entityKey}:${index}`,
        ...candidate,
        source: "operational_reasoning_runtime",
      }));
  }
}

export const operationalReasoningRuntime = new OperationalReasoningRuntime();
