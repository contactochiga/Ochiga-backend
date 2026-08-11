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

export function isUnresolvedMaintenanceStatus(value: unknown) {
  return !/closed|resolved|completed/i.test(text(value));
}

export function maintenanceRecordsFromContext(
  object: OperationalObject,
  input: CanonicalConversationRequest,
) {
  const relationships = { ...recordOf(object.relationships), ...recordOf(input.relationships) };
  const source = Array.isArray(relationships.maintenance_requests)
    ? relationships.maintenance_requests
    : Array.isArray(relationships.maintenance)
      ? relationships.maintenance
      : [];
  return source.map(recordOf);
}

export function unresolvedMaintenanceRecordsForContext(
  object: OperationalObject,
  input: CanonicalConversationRequest,
) {
  return maintenanceRecordsFromContext(object, input).filter((item) => isUnresolvedMaintenanceStatus(item.status));
}
