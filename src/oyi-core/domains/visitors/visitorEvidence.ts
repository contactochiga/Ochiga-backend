import type {
  CanonicalConversationRequest,
  OperationalObject,
} from "../../contracts/canonicalConversation";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function visitorRecordsFromContext(
  object: OperationalObject,
  input: CanonicalConversationRequest,
) {
  const relationships = { ...recordOf(object.relationships), ...recordOf(input.relationships) };
  const source = Array.isArray(relationships.visitors)
    ? relationships.visitors
    : Array.isArray(relationships.visitor_access)
      ? relationships.visitor_access
      : Array.isArray(relationships.access_passes)
        ? relationships.access_passes
        : [];
  return source.map(recordOf);
}

export function visitorAccessStatus(value: unknown) {
  const raw = text(value).toLowerCase();
  if (/expired|revoked|denied|cancelled|cancelled/i.test(raw)) return "inactive";
  if (/arrived|entered|checked_in|active|approved|valid/i.test(raw)) return "active";
  if (/pending|waiting|requested/i.test(raw)) return "pending";
  return raw || "unknown";
}

export function redactAccessCredentialForConversation(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  return "[redacted access credential]";
}
