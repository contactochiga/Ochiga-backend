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

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  };
}

export async function loadWalletTransactionFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  if (!scope.home_id) return [];
  try {
    const fromIso = contract.temporal_scope.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id,wallet_id,home_id,user_id,direction,type,amount,reference,status,metadata,created_at,updated_at")
      .eq("home_id", scope.home_id)
      .gte("created_at", fromIso)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map((row: any): IntelligenceFact => {
      const metadata = recordOf(row.metadata);
      const category = text(metadata.category || metadata.service_category || row.type || "wallet");
      const description = cleanLabel(metadata.description || metadata.service_name || metadata.title || row.reference || row.type, "Wallet transaction");
      return {
        fact_id: `wallet-transaction:${row.id}`,
        domain: /electricity|water|internet|utility|power|gas/i.test(`${category} ${description}`) ? "utilities" : "wallet",
        fact_type: "wallet_transaction",
        scope: { estate_id: scope.estate_id, home_id: row.home_id || scope.home_id, room_id: null },
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
        occurred_at: row.created_at || row.updated_at || null,
        observed_at: new Date().toISOString(),
        source_type: "database",
        source_id: String(row.id),
        truth_state: "confirmed",
        confidence: 0.9,
        freshness: row.created_at || "historical",
        privacy_class: "resident_home_private",
        permissions: ["wallet.read"],
        evidence: [{ type: "wallet_transactions", id: row.id, status: row.status || null }],
      };
    });
  } catch (error) {
    logger.warn("conversation_wallet_transaction_load_failed", { error, home_id: scope.home_id, estate_id: scope.estate_id });
    return [];
  }
}
