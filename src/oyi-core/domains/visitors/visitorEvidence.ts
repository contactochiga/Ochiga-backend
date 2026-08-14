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

// Legacy context-derived accessor — retained for any presentation code that
// still reads visitor records off the hydrated operational object. Direct
// evidence below is the source for the visitors.pending.read capability.
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

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
  };
}

function unavailableVisitorFact(input: {
  scope: ReturnType<typeof currentScope>;
  reason: string;
  contract: IntelligenceRequestContract;
}): IntelligenceFact {
  const now = new Date().toISOString();
  return {
    fact_id: `visitor-access-unavailable:${input.contract.conversation_request_id}`,
    domain: "visitors",
    fact_type: "visitor_access",
    scope: { estate_id: input.scope.estate_id, home_id: input.scope.home_id, room_id: null },
    object: { object_type: "visitor_access", canonical_id: input.scope.home_id || input.scope.estate_id || "unknown-scope", label: "Visitor access" },
    statement: "Visitor access evidence is unavailable right now.",
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
    permissions: ["visitors.read"],
    evidence: [{ type: "visitor_access", status: "unavailable", reason: input.reason }],
  };
}

function visitorFromRow(row: Record<string, unknown>, scope: ReturnType<typeof currentScope>): IntelligenceFact {
  const name = text(row.visitor_name) || "Visitor";
  const status = visitorAccessStatus(row.status);
  return {
    fact_id: `visitor-access:${row.id}`,
    domain: "visitors",
    fact_type: "visitor_access",
    scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || scope.home_id, room_id: null },
    object: { object_type: "visitor_access", canonical_id: String(row.id), label: name },
    statement: `${name}: ${status}${row.purpose ? ` (${text(row.purpose)})` : ""}.`,
    value: {
      visitor_name: name,
      purpose: text(row.purpose) || null,
      status,
      // Never carry the raw access code into conversation evidence —
      // redacted at the source, matching redactAccessCredentialForConversation.
      access_code: redactAccessCredentialForConversation(row.access_code),
      expires_at: row.expires_at || null,
      created_at: row.created_at || null,
    },
    previous_value: null,
    occurred_at: text(row.created_at) || null,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: String(row.id),
    truth_state: "confirmed",
    confidence: 0.9,
    freshness: text(row.updated_at || row.created_at) || "historical",
    privacy_class: "security_sensitive",
    permissions: ["visitors.read"],
    evidence: [{ type: "visitor_access", id: row.id, status }],
  };
}

// Direct evidence loader — queries visitor_access directly, scoped
// server-side (home_id for the consumer surface, estate_id for facility
// staff), modelled on wallet/walletEvidence.ts's loadWalletTransactionFacts.
// Access codes are redacted before they ever become conversation evidence.
export async function loadVisitorAccessFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  const isFacilitySurface = input.surface === "facility";
  if (isFacilitySurface ? !scope.estate_id : !scope.home_id) return [];
  const diagnosticBase = {
    capability_key: "visitors.pending.read",
    surface: input.surface,
    estate_id: scope.estate_id,
    home_id: scope.home_id,
    temporal_mode: contract.temporal_scope.mode,
  };
  try {
    let query = supabaseAdmin
      .from("visitor_access")
      .select("id,estate_id,home_id,visitor_name,purpose,access_code,status,expires_at,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(50);
    query = isFacilitySurface ? query.eq("estate_id", scope.estate_id) : query.eq("home_id", scope.home_id);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any) => visitorFromRow(row, scope));
    logger.info("oyi_visitor_access_evidence_loaded", {
      ...diagnosticBase,
      query_row_count: rows.length,
      fact_count: facts.length,
      result_type: facts.length ? "answered" : "empty",
    });
    return facts;
  } catch (error) {
    logger.warn("conversation_visitor_access_load_failed", {
      ...diagnosticBase,
      query_row_count: 0,
      fact_count: 1,
      result_type: "unavailable",
      error,
    });
    return [unavailableVisitorFact({ scope, reason: "visitor_access_query_failed", contract })];
  }
}
