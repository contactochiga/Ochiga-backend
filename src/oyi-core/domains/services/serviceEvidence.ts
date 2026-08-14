import type { OisContext } from "../../../types/oisContext";
import type {
  CanonicalConversationRequest,
  IntelligenceFact,
  OperationalObject,
} from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import { loadServiceAccountFacts } from "../utilities/utilityEvidence";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// Direct evidence: every registered service (utility service_keys AND the
// broader facility charges like service_charge/other_facility_fees), unlike
// utilityEvidence.ts's loadServiceAccountFacts(onlyServiceKeys: UTILITY_
// SERVICE_KEYS) which narrows to the classic-utility subset. Same table,
// same loader, deliberately different filter — this is the real difference
// between "services" and "utilities" in this schema (they are not separate
// data domains; see the schema audit).
export async function loadServicesActiveFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  return loadServiceAccountFacts(input, oisContext, contract, { domain: "services" });
}

export function serviceRecordsFromContext(
  object: OperationalObject,
  input: CanonicalConversationRequest,
) {
  const relationships = { ...recordOf(object.relationships), ...recordOf(input.relationships) };
  const source = Array.isArray(relationships.service_requests)
    ? relationships.service_requests
    : Array.isArray(relationships.services)
      ? relationships.services
      : Array.isArray(relationships.service_accounts)
        ? relationships.service_accounts
        : Array.isArray(relationships.service_transactions)
          ? relationships.service_transactions
          : [];
  return source.map(recordOf);
}

export function serviceStatus(value: unknown) {
  const raw = text(value).toLowerCase();
  if (/completed|fulfilled|paid|active|available|confirmed|linked/.test(raw)) return "active";
  if (/pending|scheduled|booked|processing|manual_review|awaiting/.test(raw)) return "pending";
  if (/cancelled|canceled|failed|expired|unavailable|setup_needed|disabled/.test(raw)) return "attention";
  return raw || "unknown";
}

export function serviceFinancialReference(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  return raw.length > 12 ? `${raw.slice(0, 4)}...${raw.slice(-4)}` : raw;
}
