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

export function isUnresolvedMaintenanceStatus(value: unknown) {
  return !/closed|resolved|completed/i.test(text(value));
}

// Legacy context-derived accessors — retained for any presentation code that
// still reads maintenance records off the hydrated operational object (e.g.
// a linked-issue summary on a device/room object). Direct evidence below is
// the source for the maintenance.requests.read capability itself.
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

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
  };
}

function unavailableMaintenanceFact(input: {
  scope: ReturnType<typeof currentScope>;
  reason: string;
  contract: IntelligenceRequestContract;
}): IntelligenceFact {
  const now = new Date().toISOString();
  return {
    fact_id: `maintenance-request-unavailable:${input.contract.conversation_request_id}`,
    domain: "maintenance",
    fact_type: "maintenance_request",
    scope: { estate_id: input.scope.estate_id, home_id: input.scope.home_id, room_id: null },
    object: { object_type: "maintenance", canonical_id: input.scope.home_id || input.scope.estate_id || "unknown-scope", label: "Maintenance requests" },
    statement: "Maintenance request evidence is unavailable right now.",
    value: { reason: input.reason },
    previous_value: null,
    occurred_at: null,
    observed_at: now,
    source_type: "database",
    source_id: null,
    truth_state: "unavailable",
    confidence: 0,
    freshness: "unavailable",
    privacy_class: "resident_home_private",
    permissions: ["maintenance.read"],
    evidence: [{ type: "maintenance_requests", status: "unavailable", reason: input.reason }],
  };
}

function maintenanceFromRow(row: Record<string, unknown>, scope: ReturnType<typeof currentScope>): IntelligenceFact {
  const title = text(row.title) || "Maintenance request";
  const status = text(row.status) || "open";
  const priority = text(row.priority) || "medium";
  return {
    fact_id: `maintenance-request:${row.id}`,
    domain: "maintenance",
    fact_type: "maintenance_request",
    scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || scope.home_id, room_id: text(row.room_id) || null },
    object: { object_type: "maintenance_request", canonical_id: String(row.id), label: title },
    statement: `${title}: ${status}${priority ? ` (${priority} priority)` : ""}.`,
    value: {
      title,
      description: text(row.description) || null,
      category: text(row.category) || null,
      priority,
      status,
      assigned_to: text(row.assigned_to) || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    },
    previous_value: null,
    occurred_at: text(row.created_at) || null,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: String(row.id),
    truth_state: "confirmed",
    confidence: 0.9,
    freshness: text(row.updated_at || row.created_at) || "historical",
    privacy_class: "resident_home_private",
    permissions: ["maintenance.read"],
    evidence: [{ type: "maintenance_requests", id: row.id, status }],
  };
}

// Direct evidence loader — queries maintenance_requests directly, scoped
// server-side (home_id for the consumer surface, estate_id for facility
// staff), modelled on wallet/walletEvidence.ts's loadWalletTransactionFacts.
// Never reads client-supplied `input.relationships` for this capability.
export async function loadMaintenanceRequestFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  const isFacilitySurface = input.surface === "facility";
  if (isFacilitySurface ? !scope.estate_id : !scope.home_id) return [];
  const diagnosticBase = {
    capability_key: "maintenance.requests.read",
    surface: input.surface,
    estate_id: scope.estate_id,
    home_id: scope.home_id,
    temporal_mode: contract.temporal_scope.mode,
  };
  try {
    // Programme 4 Phase L — resident_id/category/priority were never real
    // columns on maintenance_requests (verified against every migration
    // that touches this table; the base schema only has user_id, and no
    // later migration adds the other two). This select always errored,
    // so this loader silently returned "unavailable" for every call —
    // Direct Evidence for maintenance never actually worked. Fixed to
    // select only columns that exist; maintenanceFromRow's existing
    // `|| null` / `|| "medium"` fallbacks already handle their absence
    // safely, so no other code change is needed.
    let query = supabaseAdmin
      .from("maintenance_requests")
      .select("id,estate_id,home_id,room_id,user_id,title,description,status,assigned_to,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(50);
    query = isFacilitySurface ? query.eq("estate_id", scope.estate_id) : query.eq("home_id", scope.home_id);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any) => maintenanceFromRow(row, scope));
    logger.info("oyi_maintenance_request_evidence_loaded", {
      ...diagnosticBase,
      query_row_count: rows.length,
      fact_count: facts.length,
      result_type: facts.length ? "answered" : "empty",
    });
    return facts;
  } catch (error) {
    logger.warn("conversation_maintenance_request_load_failed", {
      ...diagnosticBase,
      query_row_count: 0,
      fact_count: 1,
      result_type: "unavailable",
      error,
    });
    return [unavailableMaintenanceFact({ scope, reason: "maintenance_request_query_failed", contract })];
  }
}
