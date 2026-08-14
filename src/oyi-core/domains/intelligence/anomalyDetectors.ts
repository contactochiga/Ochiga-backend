import { randomUUID } from "crypto";
import type { IntelligenceFact } from "../../contracts/canonicalConversation";
import type { OperationalAnomaly } from "../../contracts/intelligence";
import type { AnomalyDetector, DetectorContext, DetectorResult } from "./detectorTypes";
import { loadDeviceEventHistory } from "./deviceEventEvidence";
import { loadMaintenanceRequestFacts } from "../maintenance/maintenanceEvidence";
import { loadAutomationRunFacts } from "../automations/sceneAutomationEvidence";
import { loadSecurityIncidentFacts } from "../security/securityEvidence";
import { loadVisitorAccessFacts } from "../visitors/visitorEvidence";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectRefFromFact(fact: IntelligenceFact) {
  return fact.object ? { object_type: fact.object.object_type, canonical_id: fact.object.canonical_id, label: fact.object.label, estate_id: fact.scope?.estate_id || null, home_id: fact.scope?.home_id || null, room_id: fact.scope?.room_id || null } : null;
}

function baseAnomaly(input: Pick<OperationalAnomaly, "domain" | "anomaly_type" | "severity" | "confidence" | "evidence_ids" | "object_refs" | "window" | "baseline" | "observed" | "deviation" | "explanation" | "source_model" | "source_model_version"> & { scope: OperationalAnomaly["scope"] }): OperationalAnomaly {
  return {
    anomaly_id: randomUUID(),
    domain: input.domain,
    anomaly_type: input.anomaly_type,
    scope: input.scope,
    subject: input.object_refs[0] || null,
    object_refs: input.object_refs,
    generated_at: new Date().toISOString(),
    window: input.window,
    baseline: input.baseline,
    observed: input.observed,
    deviation: input.deviation,
    severity: input.severity,
    confidence: input.confidence,
    evidence_ids: input.evidence_ids,
    status: "active",
    explanation: input.explanation,
    source_model: input.source_model,
    source_model_version: input.source_model_version,
    limitations: [],
    payload: {},
  };
}

// device.offline_cluster:v1 — repeated offline/failure events for the same
// device within a rolling window. Reuses the real device_events table the
// legacy predictionEngine.ts already proved works (Programme 1's device
// evidence only exposes current state, not history — see
// deviceEventEvidence.ts's comment for why this reads deeper).
export const deviceOfflineClusterDetector: AnomalyDetector = {
  id: "device.offline_cluster",
  version: "v1",
  domain: "devices",
  detect: async (context: DetectorContext): Promise<DetectorResult> => {
    const { rows, unavailable } = await loadDeviceEventHistory(context.scope, 7, 200);
    if (unavailable) return { anomalies: [], data_quality: "unavailable", evidence_count: 0 };
    if (!rows.length) return { anomalies: [], data_quality: "sufficient", evidence_count: 0 };
    const offlineEvents = rows.filter((row) => /offline|failure|failed|disconnect/i.test(`${row.event_type} ${JSON.stringify(row.new_state || {})}`));
    const byDevice = new Map<string, typeof offlineEvents>();
    for (const row of offlineEvents) {
      const key = text(row.device_id);
      if (!key) continue;
      byDevice.set(key, [...(byDevice.get(key) || []), row]);
    }
    const anomalies: OperationalAnomaly[] = [];
    for (const [deviceId, deviceRows] of byDevice) {
      if (deviceRows.length < 3) continue;
      anomalies.push(baseAnomaly({
        domain: "devices",
        anomaly_type: "device_offline_cluster",
        scope: { estate_id: deviceRows[0].estate_id || context.scope.estate_id, home_id: deviceRows[0].home_id || context.scope.home_id, room_id: deviceRows[0].room_id || null },
        object_refs: [{ object_type: "device", canonical_id: deviceId, label: `Device ${deviceId}` }],
        window: { from: deviceRows[deviceRows.length - 1].occurred_at, to: deviceRows[0].occurred_at },
        baseline: "Fewer than 3 offline/failure events per device in a 7-day window is typical.",
        observed: `${deviceRows.length} offline/failure events in the last 7 days.`,
        deviation: `${deviceRows.length - 2} more offline/failure events than the informal 2-event baseline.`,
        severity: deviceRows.length >= 5 ? "warning" : "attention",
        confidence: deviceRows.length >= 5 ? 0.7 : 0.5,
        evidence_ids: deviceRows.slice(0, 10).map((row) => row.id),
        explanation: `This device produced ${deviceRows.length} offline or failure signals in the last 7 days.`,
        source_model: "device.offline_cluster",
        source_model_version: "v1",
      }));
    }
    return { anomalies, data_quality: rows.length < 5 ? "sparse" : "sufficient", evidence_count: rows.length };
  },
};

// maintenance.aging:v1 — reuses Programme 1's direct maintenance evidence
// as-is (already has status/priority/created_at, no deeper history needed).
export const maintenanceAgingDetector: AnomalyDetector = {
  id: "maintenance.aging",
  version: "v1",
  domain: "maintenance",
  detect: async (context: DetectorContext): Promise<DetectorResult> => {
    const facts = await loadMaintenanceRequestFacts(context.input, context.oisContext, context.contract);
    if (facts.some((fact) => fact.truth_state === "unavailable")) return { anomalies: [], data_quality: "unavailable", evidence_count: 0 };
    const open = facts.filter((fact) => /open|unresolved|pending|in_progress/i.test(text(recordOf(fact.value).status)));
    const anomalies: OperationalAnomaly[] = [];
    const now = Date.now();
    for (const fact of open) {
      const createdAt = text(fact.occurred_at);
      if (!createdAt) continue;
      const ageDays = Math.floor((now - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000));
      if (ageDays < 3) continue;
      const ref = objectRefFromFact(fact);
      anomalies.push(baseAnomaly({
        domain: "maintenance",
        anomaly_type: "maintenance_aging",
        scope: { estate_id: fact.scope?.estate_id || context.scope.estate_id, home_id: fact.scope?.home_id || context.scope.home_id, room_id: fact.scope?.room_id || null },
        object_refs: ref ? [ref] : [],
        window: { from: createdAt, to: new Date().toISOString() },
        baseline: "Most maintenance requests are resolved within a few days.",
        observed: `Open for ${ageDays} days.`,
        deviation: `${ageDays} days without resolution.`,
        severity: ageDays >= 7 ? "warning" : "attention",
        confidence: ageDays >= 7 ? 0.75 : 0.55,
        evidence_ids: [fact.fact_id],
        explanation: `${fact.object?.label || "This maintenance request"} has remained open for about ${ageDays} days.`,
        source_model: "maintenance.aging",
        source_model_version: "v1",
      }));
    }
    return { anomalies, data_quality: "sufficient", evidence_count: facts.length };
  },
};

// automation.failure_rate:v1 — reuses Programme 1's automation run evidence.
export const automationFailureRateDetector: AnomalyDetector = {
  id: "automation.failure_rate",
  version: "v1",
  domain: "automations",
  detect: async (context: DetectorContext): Promise<DetectorResult> => {
    const facts = await loadAutomationRunFacts(context.input, context.oisContext, context.contract);
    if (facts.some((fact) => fact.truth_state === "unavailable")) return { anomalies: [], data_quality: "unavailable", evidence_count: 0 };
    const byAutomation = new Map<string, IntelligenceFact[]>();
    for (const fact of facts) {
      const automationId = text(recordOf(fact.value).automation_id);
      if (!automationId) continue;
      byAutomation.set(automationId, [...(byAutomation.get(automationId) || []), fact]);
    }
    const anomalies: OperationalAnomaly[] = [];
    for (const [automationId, runs] of byAutomation) {
      const failed = runs.filter((run) => text(recordOf(run.value).status).toLowerCase() === "failed");
      if (failed.length < 2 || runs.length < 2) continue;
      const failureRate = failed.length / runs.length;
      if (failureRate < 0.3) continue;
      anomalies.push(baseAnomaly({
        domain: "automations",
        anomaly_type: "automation_failure_rate",
        scope: { estate_id: runs[0].scope?.estate_id || context.scope.estate_id, home_id: runs[0].scope?.home_id || context.scope.home_id, room_id: null },
        object_refs: [{ object_type: "automation", canonical_id: automationId, label: `Automation ${automationId}` }],
        window: { from: runs[runs.length - 1].occurred_at, to: runs[0].occurred_at },
        baseline: "A healthy automation succeeds in most of its recent runs.",
        observed: `${failed.length} of ${runs.length} recent runs failed (${Math.round(failureRate * 100)}%).`,
        deviation: `${Math.round(failureRate * 100)}% failure rate over the last ${runs.length} runs.`,
        severity: failureRate >= 0.6 ? "warning" : "attention",
        confidence: runs.length >= 4 ? 0.7 : 0.45,
        evidence_ids: failed.slice(0, 10).map((run) => run.fact_id),
        explanation: `This automation failed ${failed.length} of its last ${runs.length} recorded runs.`,
        source_model: "automation.failure_rate",
        source_model_version: "v1",
      }));
    }
    return { anomalies, data_quality: facts.length < 3 ? "sparse" : "sufficient", evidence_count: facts.length };
  },
};

// security.incident_frequency:v1 — reuses Programme 1's security evidence
// (facility_incidents, the real table). Deliberately conservative: only
// flags unresolved-incident VOLUME, never fabricates failed-access data.
export const securityIncidentFrequencyDetector: AnomalyDetector = {
  id: "security.incident_frequency",
  version: "v1",
  domain: "security",
  detect: async (context: DetectorContext): Promise<DetectorResult> => {
    const facts = await loadSecurityIncidentFacts(context.input, context.oisContext, context.contract);
    if (facts.some((fact) => fact.truth_state === "unavailable")) return { anomalies: [], data_quality: "unavailable", evidence_count: 0 };
    const unresolved = facts.filter((fact) => !/resolved|closed/i.test(text(recordOf(fact.value).status)));
    if (unresolved.length < 2) return { anomalies: [], data_quality: "sufficient", evidence_count: facts.length };
    const anomalies: OperationalAnomaly[] = [baseAnomaly({
      domain: "security",
      anomaly_type: "security_incident_frequency",
      scope: { estate_id: context.scope.estate_id, home_id: context.scope.home_id, room_id: null },
      object_refs: unresolved.slice(0, 5).map(objectRefFromFact).filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)),
      window: null,
      baseline: "Most homes have zero or one unresolved security incident at a time.",
      observed: `${unresolved.length} unresolved security incidents on record.`,
      deviation: `${unresolved.length} unresolved incidents recorded.`,
      severity: unresolved.some((fact) => /critical|high/i.test(text(recordOf(fact.value).severity))) ? "critical" : "warning",
      confidence: 0.65,
      evidence_ids: unresolved.slice(0, 10).map((fact) => fact.fact_id),
      explanation: `${unresolved.length} security incidents remain unresolved.`,
      source_model: "security.incident_frequency",
      source_model_version: "v1",
    })];
    return { anomalies, data_quality: "sufficient", evidence_count: facts.length };
  },
};

// visitor.volume:v1 — reuses Programme 1's visitor evidence.
export const visitorVolumeDetector: AnomalyDetector = {
  id: "visitor.volume",
  version: "v1",
  domain: "visitors",
  detect: async (context: DetectorContext): Promise<DetectorResult> => {
    const facts = await loadVisitorAccessFacts(context.input, context.oisContext, context.contract);
    if (facts.some((fact) => fact.truth_state === "unavailable")) return { anomalies: [], data_quality: "unavailable", evidence_count: 0 };
    if (facts.length < 8) return { anomalies: [], data_quality: "sufficient", evidence_count: facts.length };
    const anomalies: OperationalAnomaly[] = [baseAnomaly({
      domain: "visitors",
      anomaly_type: "visitor_volume",
      scope: { estate_id: context.scope.estate_id, home_id: context.scope.home_id, room_id: null },
      object_refs: [],
      window: null,
      baseline: "Typical recent visitor volume is well under 8 records.",
      observed: `${facts.length} visitor access records on file.`,
      deviation: `${facts.length} visitor records — above the informal 8-record baseline.`,
      severity: facts.length >= 15 ? "attention" : "info",
      confidence: 0.4,
      evidence_ids: facts.slice(0, 10).map((fact) => fact.fact_id),
      explanation: `${facts.length} visitor records were found — this may be normal but is worth noting.`,
      source_model: "visitor.volume",
      source_model_version: "v1",
    })];
    return { anomalies, data_quality: "sufficient", evidence_count: facts.length };
  },
};

export const ANOMALY_DETECTORS: AnomalyDetector[] = [
  deviceOfflineClusterDetector,
  maintenanceAgingDetector,
  automationFailureRateDetector,
  securityIncidentFrequencyDetector,
  visitorVolumeDetector,
];
