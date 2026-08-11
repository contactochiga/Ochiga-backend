import type {
  CanonicalConversationRequest,
  OperationalObject,
} from "../../runtime/canonicalConversationRuntime";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
