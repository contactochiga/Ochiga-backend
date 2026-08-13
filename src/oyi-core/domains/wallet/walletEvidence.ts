import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import type { OisContext } from "../../../types/oisContext";
import type {
  CanonicalConversationRequest,
  IntelligenceFact,
} from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown, fallback: string) {
  const next = text(value);
  return next || fallback;
}

function isInternalReference(value: unknown) {
  const raw = text(value);
  return !raw
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
    || /^[a-z]+_[a-z0-9]{8,}$/i.test(raw)
    || /^[0-9a-f-]{18,}$/i.test(raw);
}

export function residentWalletDescription(row: Record<string, unknown>) {
  const metadata = recordOf(row.metadata);
  const preferred = [metadata.description, metadata.service_name, metadata.title].find((item) => !isInternalReference(item));
  if (preferred) return cleanLabel(preferred, "Wallet transaction");
  const type = text(row.type || metadata.category || metadata.service_category).toLowerCase();
  if (/electricity|power/.test(type)) return "Electricity purchase";
  if (/water/.test(type)) return "Water payment";
  if (/internet|data/.test(type)) return "Internet payment";
  if (/fund|top.?up|credit/.test(type)) return "Wallet funding";
  return "Wallet transaction";
}

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  };
}

function unavailableWalletFact(input: {
  scope: ReturnType<typeof currentScope>;
  reason: string;
  contract: IntelligenceRequestContract;
}): IntelligenceFact {
  const now = new Date().toISOString();
  return {
    fact_id: `wallet-transaction-unavailable:${input.contract.conversation_request_id}`,
    domain: "wallet",
    fact_type: "wallet_transaction",
    scope: { estate_id: input.scope.estate_id, home_id: input.scope.home_id, room_id: null },
    object: { object_type: "wallet", canonical_id: input.scope.home_id || "unknown-home", label: "Wallet transactions" },
    statement: "Wallet transaction evidence is unavailable right now.",
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
    permissions: ["wallet.read"],
    evidence: [{ type: "wallet_transactions", status: "unavailable", reason: input.reason }],
  };
}

function walletFromRow(row: Record<string, unknown>, scope: ReturnType<typeof currentScope>): IntelligenceFact {
  const metadata = recordOf(row.metadata);
  const category = text(metadata.category || metadata.service_category || row.type || "wallet");
  const description = residentWalletDescription(row);
  return {
    fact_id: `wallet-transaction:${row.id}`,
    domain: /electricity|water|internet|utility|power|gas/i.test(`${category} ${description}`) ? "utilities" : "wallet",
    fact_type: "wallet_transaction",
    scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || scope.home_id, room_id: null },
    object: { object_type: "transaction", canonical_id: String(row.id), label: description },
    statement: `${description}: ${row.direction || "transaction"} ${row.amount || 0}.`,
    value: {
      date: row.created_at || row.updated_at || null,
      description,
      type: text(row.type || category) || "transaction",
      direction: text(row.direction) || null,
      amount: Number(row.amount || 0),
      status: text(row.status) || "recorded",
      category,
      reference: text(row.reference) || null,
    },
    previous_value: null,
    occurred_at: text(row.created_at || row.updated_at) || null,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: String(row.id),
    truth_state: "confirmed",
    confidence: 0.9,
    freshness: text(row.created_at) || "historical",
    privacy_class: "resident_home_private",
    permissions: ["wallet.read"],
    evidence: [{ type: "wallet_transactions", id: row.id, status: row.status || null }],
  };
}

export async function loadWalletTransactionFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  if (!scope.home_id) return [];
  const diagnosticBase = {
    capability_key: "wallet.transactions.read",
    actor_id: text(recordOf(input.context).actor_id || recordOf(input.context).user_id) || null,
    estate_id: scope.estate_id,
    home_id: scope.home_id,
    temporal_mode: contract.temporal_scope.mode,
    from: contract.temporal_scope.from,
    to: contract.temporal_scope.to,
    query_home_id: scope.home_id,
  };
  try {
    const boundedTemporalModes = new Set(["today", "yesterday", "custom", "current_month"]);
    const applyTemporalBounds = boundedTemporalModes.has(contract.temporal_scope.mode);
    const walletResult = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("home_id", scope.home_id)
      .limit(50);
    if (walletResult.error) throw walletResult.error;
    const walletIds = (Array.isArray(walletResult.data) ? walletResult.data : []).map((row: any) => text(row.id)).filter(Boolean);
    let query = supabaseAdmin
      .from("wallet_transactions")
      .select("id,wallet_id,home_id,user_id,direction,type,amount,reference,status,metadata,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (walletIds.length) {
      query = query.or(`home_id.eq.${scope.home_id},wallet_id.in.(${walletIds.join(",")})`);
    } else {
      query = query.eq("home_id", scope.home_id);
    }
    if (applyTemporalBounds && contract.temporal_scope.from) query = query.gte("created_at", contract.temporal_scope.from);
    if (applyTemporalBounds && contract.temporal_scope.to) query = query.lte("created_at", contract.temporal_scope.to);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any) => walletFromRow(row, scope));
    logger.info("oyi_wallet_transaction_evidence_loaded", {
      ...diagnosticBase,
      query_wallet_count: walletIds.length,
      query_row_count: rows.length,
      fact_count: facts.length,
      result_type: facts.length ? "answered" : "empty",
    });
    return facts;
  } catch (error) {
    logger.warn("conversation_wallet_transaction_load_failed", {
      ...diagnosticBase,
      query_row_count: 0,
      fact_count: 1,
      result_type: "unavailable",
      error,
    });
    return [unavailableWalletFact({ scope, reason: "wallet_transaction_query_failed", contract })];
  }
}
