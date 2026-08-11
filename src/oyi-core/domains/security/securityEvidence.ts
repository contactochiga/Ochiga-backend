import { logger } from "../../../observability/logger";
import type {
  CanonicalConversationRequest,
  IntelligenceFact,
  OperationalObject,
} from "../../contracts/canonicalConversation";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
