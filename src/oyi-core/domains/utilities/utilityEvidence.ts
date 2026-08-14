import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import type { OisContext } from "../../../types/oisContext";
import type {
  CanonicalConversationRequest,
  IntelligenceFact,
} from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import { loadWalletTransactionFacts } from "../wallet/walletEvidence";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// home_service_accounts/estate_service_configs.service_key covers both true
// utilities and general facility service charges under one CHECK-constrained
// vocabulary. This is the honest utilities subset — service_charge and
// other_facility_fees are "services", not utilities (see serviceEvidence.ts,
// which reuses these same loaders unfiltered for the broader services view).
export const UTILITY_SERVICE_KEYS = [
  "utility_token",
  "water_service",
  "gas_service",
  "internet_service",
  "fiber_internet",
  "generator_recovery",
  "solar_battery_service",
];

export function currentServiceScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
  };
}

function unavailableServiceFact(input: {
  domain: string;
  factType: string;
  scope: ReturnType<typeof currentServiceScope>;
  reason: string;
  contract: IntelligenceRequestContract;
  permissions: string[];
}): IntelligenceFact {
  const now = new Date().toISOString();
  return {
    fact_id: `${input.factType}-unavailable:${input.contract.conversation_request_id}`,
    domain: input.domain,
    fact_type: input.factType,
    scope: { estate_id: input.scope.estate_id, home_id: input.scope.home_id, room_id: null },
    object: { object_type: input.factType, canonical_id: input.scope.home_id || input.scope.estate_id || "unknown-scope", label: "Service evidence" },
    statement: "Service evidence is unavailable right now.",
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
    permissions: input.permissions,
    evidence: [{ type: input.factType, status: "unavailable", reason: input.reason }],
  };
}

// Direct evidence: which services/utilities are enabled + linked for a home
// (facility: whole estate). Merges home_service_assignments.enabled (the
// real entitlement flag) with home_service_accounts.status/linked/provider
// (the real account state). Never reads/reports `balance`/`outstanding` —
// those columns exist on home_service_accounts but are never written by any
// code path in this codebase (proven via schema audit), so surfacing them
// would misrepresent a permanently-null column as a real balance.
export async function loadServiceAccountFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
  options: { onlyServiceKeys?: string[]; domain?: string } = {},
): Promise<IntelligenceFact[]> {
  const scope = currentServiceScope(input, oisContext);
  const isFacilitySurface = input.surface === "facility";
  const domain = options.domain || "services";
  if (isFacilitySurface ? !scope.estate_id : !scope.home_id) return [];
  const diagnosticBase = { capability_domain: domain, surface: input.surface, estate_id: scope.estate_id, home_id: scope.home_id };
  try {
    const assignmentsQuery = supabaseAdmin
      .from("home_service_assignments")
      .select("home_id,service_key,enabled,scope,updated_at")
      .limit(200);
    const accountsQuery = supabaseAdmin
      .from("home_service_accounts")
      .select("id,home_id,service_key,provider,status,linked,due_date,expires_at,updated_at")
      .limit(200);
    const [assignmentsResult, accountsResult] = await Promise.all([
      isFacilitySurface ? assignmentsQuery.eq("estate_id", scope.estate_id) : assignmentsQuery.eq("home_id", scope.home_id),
      isFacilitySurface ? accountsQuery.eq("estate_id", scope.estate_id) : accountsQuery.eq("home_id", scope.home_id),
    ]);
    if (assignmentsResult.error) throw assignmentsResult.error;
    if (accountsResult.error) throw accountsResult.error;
    const assignments = Array.isArray(assignmentsResult.data) ? assignmentsResult.data : [];
    const accounts = Array.isArray(accountsResult.data) ? accountsResult.data : [];
    const accountByHomeService = new Map(accounts.map((row: any) => [`${row.home_id}:${row.service_key}`, row]));
    const keys = options.onlyServiceKeys ? new Set(options.onlyServiceKeys) : null;
    const rows = assignments.filter((row: any) => !keys || keys.has(String(row.service_key)));
    const facts = rows.map((row: any): IntelligenceFact => {
      const account = accountByHomeService.get(`${row.home_id}:${row.service_key}`) as Record<string, unknown> | undefined;
      const enabled = Boolean(row.enabled);
      const accountStatus = text(account?.status) || "unknown";
      const linked = Boolean(account?.linked);
      const active = enabled && accountStatus === "active" && linked;
      return {
        fact_id: `service-account:${row.home_id}:${row.service_key}`,
        domain,
        fact_type: "service_account",
        scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || scope.home_id, room_id: null },
        object: { object_type: "service_account", canonical_id: `${row.home_id}:${row.service_key}`, label: text(row.service_key) },
        statement: `${text(row.service_key)}: ${active ? "active" : enabled ? "enabled but not linked" : "not enabled"}.`,
        value: {
          service_key: text(row.service_key),
          enabled,
          account_status: accountStatus,
          linked,
          active,
          provider: text(account?.provider) || null,
          due_date: account?.due_date || null,
          expires_at: account?.expires_at || null,
        },
        previous_value: null,
        occurred_at: text(row.updated_at) || null,
        observed_at: new Date().toISOString(),
        source_type: "database",
        source_id: `${row.home_id}:${row.service_key}`,
        truth_state: "confirmed",
        confidence: 0.9,
        freshness: text((account?.updated_at as string) || row.updated_at) || "historical",
        privacy_class: "resident_home_private",
        permissions: [`${domain}.read`],
        evidence: [{ type: "home_service_assignments", id: `${row.home_id}:${row.service_key}` }],
      };
    });
    logger.info("oyi_service_account_evidence_loaded", { ...diagnosticBase, query_row_count: rows.length, fact_count: facts.length, result_type: facts.length ? "answered" : "empty" });
    return facts;
  } catch (error) {
    logger.warn("conversation_service_account_load_failed", { ...diagnosticBase, error, result_type: "unavailable" });
    return [unavailableServiceFact({ domain, factType: "service_account", scope, reason: "service_account_query_failed", contract, permissions: [`${domain}.read`] })];
  }
}

// Direct evidence: the real tariff (estate_service_configs.unit_cost/
// unit_name/metadata.electricity.*). Tariff is estate-level configuration,
// not resident-private, so both surfaces read the same estate-scoped rows.
export async function loadUtilityTariffFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentServiceScope(input, oisContext);
  if (!scope.estate_id) return [];
  const diagnosticBase = { capability_domain: "utilities", surface: input.surface, estate_id: scope.estate_id };
  try {
    const { data, error } = await supabaseAdmin
      .from("estate_service_configs")
      .select("id,service_key,title,unit_cost,unit_name,currency,active,billing_mode,metadata,updated_at")
      .eq("estate_id", scope.estate_id)
      .in("service_key", UTILITY_SERVICE_KEYS.filter((key) => key !== "generator_recovery" && key !== "solar_battery_service"));
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any): IntelligenceFact => {
      const metadata = recordOf(row.metadata);
      const electricity = recordOf(metadata.electricity);
      const unitCost = Number(electricity.tariff_per_kwh ?? row.unit_cost ?? 0) || null;
      const unitName = text(row.unit_name) || (text(row.service_key) === "utility_token" ? "kWh" : null);
      return {
        fact_id: `utility-tariff:${row.service_key}`,
        domain: "utilities",
        fact_type: "utility_tariff",
        scope: { estate_id: scope.estate_id, home_id: null, room_id: null },
        object: { object_type: "utility_tariff", canonical_id: text(row.id), label: text(row.title) || text(row.service_key) },
        statement: unitCost ? `${text(row.title) || row.service_key}: ${unitCost} per ${unitName || "unit"}.` : `${text(row.title) || row.service_key}: tariff not configured.`,
        value: {
          service_key: text(row.service_key),
          title: text(row.title) || null,
          unit_cost: unitCost,
          unit_name: unitName,
          currency: text(row.currency) || "NGN",
          active: Boolean(row.active),
          billing_mode: text(row.billing_mode) || null,
        },
        previous_value: null,
        occurred_at: text(row.updated_at) || null,
        observed_at: new Date().toISOString(),
        source_type: "database",
        source_id: text(row.id),
        // Row-level "not configured" is a valid, successfully-read state — it
        // must not be tagged "unavailable" (that value is reserved for the
        // query itself failing, see the catch block below) or it would trip
        // the capability's unavailable guard and hide sibling tariffs that
        // ARE configured.
        truth_state: unitCost ? "confirmed" : "unsupported",
        confidence: unitCost ? 0.9 : 0,
        freshness: text(row.updated_at) || "historical",
        privacy_class: "building_operational",
        permissions: ["utilities.read"],
        evidence: [{ type: "estate_service_configs", id: row.id }],
      };
    });
    logger.info("oyi_utility_tariff_evidence_loaded", { ...diagnosticBase, query_row_count: rows.length, fact_count: facts.length, result_type: facts.length ? "answered" : "empty" });
    return facts;
  } catch (error) {
    logger.warn("conversation_utility_tariff_load_failed", { ...diagnosticBase, error, result_type: "unavailable" });
    return [unavailableServiceFact({ domain: "utilities", factType: "utility_tariff", scope, reason: "utility_tariff_query_failed", contract, permissions: ["utilities.read"] })];
  }
}

// Direct evidence: real vending/purchase history (service_transactions).
// This is PURCHASED units, never represented as consumption/usage — that
// distinction is proven by the schema audit (no consumption table exists).
export async function loadUtilityPurchaseFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentServiceScope(input, oisContext);
  const isFacilitySurface = input.surface === "facility";
  if (isFacilitySurface ? !scope.estate_id : !scope.home_id) return [];
  const diagnosticBase = { capability_domain: "utilities", surface: input.surface, estate_id: scope.estate_id, home_id: scope.home_id };
  try {
    let query = supabaseAdmin
      .from("service_transactions")
      .select("id,home_id,service_key,provider,amount,currency,status,computed_units,fulfilment_method,token_reference,completed_at,failure_code,safe_failure_message,created_at")
      .in("service_key", UTILITY_SERVICE_KEYS)
      .order("created_at", { ascending: false })
      .limit(50);
    query = isFacilitySurface ? query.eq("estate_id", scope.estate_id) : query.eq("home_id", scope.home_id);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any): IntelligenceFact => {
      const status = text(row.status) || "pending";
      const units = row.computed_units != null ? Number(row.computed_units) : null;
      return {
        fact_id: `utility-purchase:${row.id}`,
        domain: "utilities",
        fact_type: "utility_purchase",
        scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || scope.home_id, room_id: null },
        object: { object_type: "utility_purchase", canonical_id: String(row.id), label: `${text(row.service_key)} purchase` },
        statement: `${text(row.service_key)} purchase of ${row.amount || 0} ${text(row.currency) || "NGN"}: ${status}${units ? ` (${units} units)` : ""}.`,
        value: {
          service_key: text(row.service_key),
          provider: text(row.provider) || null,
          amount: Number(row.amount || 0),
          currency: text(row.currency) || "NGN",
          status,
          computed_units: units,
          fulfilment_method: text(row.fulfilment_method) || null,
          token_reference: text(row.token_reference) || null,
          failure_code: text(row.failure_code) || null,
          failure_message: text(row.safe_failure_message) || null,
          completed_at: row.completed_at || null,
        },
        previous_value: null,
        occurred_at: text(row.created_at) || null,
        observed_at: new Date().toISOString(),
        source_type: "database",
        source_id: String(row.id),
        truth_state: "confirmed",
        confidence: 0.9,
        freshness: text(row.completed_at || row.created_at) || "historical",
        privacy_class: "financial_sensitive",
        permissions: ["utilities.read", "wallet.read"],
        evidence: [{ type: "service_transactions", id: row.id, status }],
      };
    });
    logger.info("oyi_utility_purchase_evidence_loaded", { ...diagnosticBase, query_row_count: rows.length, fact_count: facts.length, result_type: facts.length ? "answered" : "empty" });
    return facts;
  } catch (error) {
    logger.warn("conversation_utility_purchase_load_failed", { ...diagnosticBase, error, result_type: "unavailable" });
    return [unavailableServiceFact({ domain: "utilities", factType: "utility_purchase", scope, reason: "utility_purchase_query_failed", contract, permissions: ["utilities.read"] })];
  }
}

function isUtilityTransactionFact(fact: IntelligenceFact) {
  const value = recordOf(fact.value);
  return fact.domain === "utilities"
    || /electricity|water|internet|utility|power|gas/i.test(`${value.category} ${value.description} ${value.type}`);
}

export async function loadUtilitySpendingFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const transactionFacts = await loadWalletTransactionFacts(input, oisContext, contract);
  return transactionFacts.filter((fact) => fact.fact_type === "wallet_transaction" && isUtilityTransactionFact(fact)).map((fact) => ({
    ...fact,
    domain: "utilities",
    permissions: Array.from(new Set([...(fact.permissions || []), "utilities.read"])),
    value: {
      ...recordOf(fact.value),
      utility_category: text(recordOf(fact.value).category || recordOf(fact.value).type || "utilities") || "utilities",
    },
  }));
}
