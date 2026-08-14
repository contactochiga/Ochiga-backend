import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import type { OisContext } from "../../../types/oisContext";
import type {
  CanonicalConversationRequest,
  IntelligenceFact,
  OperationalObject,
} from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
  };
}

function unavailableIncidentFact(input: {
  scope: ReturnType<typeof currentScope>;
  reason: string;
  contract: IntelligenceRequestContract;
}): IntelligenceFact {
  const now = new Date().toISOString();
  return {
    fact_id: `security-incident-unavailable:${input.contract.conversation_request_id}`,
    domain: "security",
    fact_type: "security_incident",
    scope: { estate_id: input.scope.estate_id, home_id: input.scope.home_id, room_id: null },
    object: { object_type: "security_incident", canonical_id: input.scope.home_id || input.scope.estate_id || "unknown-scope", label: "Security incidents" },
    statement: "Security incident evidence is unavailable right now.",
    value: { reason: input.reason },
    previous_value: null,
    occurred_at: null,
    observed_at: now,
    source_type: "database",
    source_id: null,
    truth_state: "unavailable",
    confidence: 0,
    freshness: "unavailable",
    privacy_class: "security_sensitive",
    permissions: ["security.read"],
    evidence: [{ type: "facility_incidents", status: "unavailable", reason: input.reason }],
  };
}

function incidentFromRow(row: Record<string, unknown>, scope: ReturnType<typeof currentScope>): IntelligenceFact {
  const title = text(row.title) || "Security incident";
  const severity = text(row.severity) || "medium";
  const status = text(row.status) || "open";
  return {
    fact_id: `security-incident:${row.id}`,
    domain: "security",
    fact_type: "security_incident",
    scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || null, room_id: text(row.room_id) || null },
    object: { object_type: "security_incident", canonical_id: String(row.id), label: title },
    statement: `${title}: ${status} (${severity} severity).`,
    value: {
      title,
      incident_type: text(row.incident_type) || null,
      severity,
      status,
      acknowledged_at: row.acknowledged_at || null,
      resolved_at: row.resolved_at || null,
      closed_at: row.closed_at || null,
      location: recordOf(row.location),
    },
    previous_value: null,
    occurred_at: text(row.opened_at) || null,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: String(row.id),
    truth_state: "confirmed",
    confidence: 0.9,
    freshness: text(row.updated_at || row.opened_at) || "historical",
    privacy_class: "security_sensitive",
    permissions: ["security.read"],
    evidence: [{ type: "facility_incidents", id: row.id, status }],
  };
}

// Direct evidence: facility_incidents, the real, actively-written security
// incident table (severity/status/ack/resolution are all real columns).
// Consumer surface is scoped strictly to home_id-matching incidents (most
// facility incidents are estate-wide operational issues with no home_id,
// so this will often be legitimately empty for a resident — that is
// correct: a resident must never see another home's or the estate's
// general security incidents). Facility surface sees the full estate list.
// "Failed access attempts" have zero backing data anywhere in this schema
// (proven: smart_access_records has no insert site) and are deliberately
// not represented here — do not invent them from this loader.
export async function loadSecurityIncidentFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  const isFacilitySurface = input.surface === "facility";
  if (isFacilitySurface ? !scope.estate_id : (!scope.estate_id || !scope.home_id)) return [];
  const diagnosticBase = { capability_key: "security.incidents.read", surface: input.surface, estate_id: scope.estate_id, home_id: scope.home_id };
  try {
    let query = supabaseAdmin
      .from("facility_incidents")
      .select("id,estate_id,home_id,room_id,title,incident_type,severity,status,location,opened_at,acknowledged_at,resolved_at,closed_at,updated_at")
      .eq("estate_id", scope.estate_id)
      .order("opened_at", { ascending: false })
      .limit(50);
    if (!isFacilitySurface) query = query.eq("home_id", scope.home_id);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any) => incidentFromRow(row, scope));
    logger.info("oyi_security_incident_evidence_loaded", { ...diagnosticBase, query_row_count: rows.length, fact_count: facts.length, result_type: facts.length ? "answered" : "empty" });
    return facts;
  } catch (error) {
    logger.warn("conversation_security_incident_load_failed", { ...diagnosticBase, error, result_type: "unavailable" });
    return [unavailableIncidentFact({ scope, reason: "security_incident_query_failed", contract })];
  }
}

export function securityRecordsFromContext(
  object: OperationalObject,
  input: CanonicalConversationRequest,
) {
  const relationships = { ...recordOf(object.relationships), ...recordOf(input.relationships) };
  const source = Array.isArray(relationships.security_incidents)
    ? relationships.security_incidents
    : Array.isArray(relationships.incidents)
      ? relationships.incidents
      : Array.isArray(relationships.alerts)
        ? relationships.alerts
        : Array.isArray(relationships.access_events)
          ? relationships.access_events
          : [];
  return source.map(recordOf);
}

export function redactSecuritySensitiveValue(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  return "[redacted security-sensitive value]";
}

export function securityIncidentStatus(value: unknown) {
  const raw = text(value).toLowerCase();
  if (/resolved|closed|acknowledged|cleared/.test(raw)) return "resolved";
  if (/critical|active|open|unresolved|alarm|escalated/.test(raw)) return "active";
  if (/pending|review|investigating/.test(raw)) return "under_review";
  return raw || "unknown";
}

export function securityRiskAllowed(claim: string, facts: IntelligenceFact[], threshold: number) {
  const count = facts.filter((fact) => {
    const value = recordOf(fact.value);
    const statement = `${fact.statement} ${fact.fact_type} ${text(value.event_type || value.type || value.status)}`.toLowerCase();
    if (/private_credential|access_code|pin|fingerprint|raw_stream|camera_secret/.test(statement)) return false;
    return /denied|mismatch|revoked|failed access|security incident|tamper|forced entry|alarm/.test(statement);
  }).length;
  const allowed = count >= threshold;
  logger.info("conversation_risk_claim_evaluated", { claim, evidence_count: count, threshold, allowed });
  return allowed;
}
