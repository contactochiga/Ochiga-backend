import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import type { OperationalScope } from "../../contracts/intelligence";

export type UtilitySpendTransaction = {
  id: string;
  amount: number;
  created_at: string;
};

// Forecasting needs a known, wide date range — Programme 1's
// loadWalletTransactionFacts bounds by contract.temporal_scope, which has
// no "wide historical window" mode (its modes are today/this_week/recent/
// etc, all narrow). Per §53 ("use direct domain evidence when a specific
// prediction requires deeper history"), this reads wallet_transactions
// directly with an explicit window, reusing the exact same utility-spend
// filtering logic Programme 1's utilityEvidence.ts already established
// (category/description/type regex match, debit-only).
export async function loadUtilitySpendHistory(scope: OperationalScope, windowDays: number): Promise<{ transactions: UtilitySpendTransaction[]; unavailable: boolean }> {
  if (!scope.home_id) return { transactions: [], unavailable: false };
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const walletResult = await supabaseAdmin.from("wallets").select("id").eq("home_id", scope.home_id).limit(50);
    if (walletResult.error) throw walletResult.error;
    const walletIds = (Array.isArray(walletResult.data) ? walletResult.data : []).map((row: any) => String(row.id)).filter(Boolean);
    if (!walletIds.length) return { transactions: [], unavailable: false };
    const { data, error } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id,wallet_id,direction,type,amount,metadata,created_at")
      .in("wallet_id", walletIds)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const transactions = rows
      .filter((row: any) => {
        if (String(row.direction).toLowerCase() === "credit") return false;
        const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
        const category = String((metadata as any).category || (metadata as any).service_category || row.type || "");
        return /electricity|water|internet|utility|power|gas/i.test(category);
      })
      .map((row: any) => ({ id: String(row.id), amount: Number(row.amount || 0), created_at: String(row.created_at) }));
    return { transactions, unavailable: false };
  } catch (error) {
    logger.warn("oyi_utility_spend_history_load_failed", { scope, error });
    return { transactions: [], unavailable: true };
  }
}

// Buckets transactions into weekly totals for the given window, oldest
// first, INCLUDING weeks with zero spend (a forecast series must not skip
// silent weeks or the trend/average would be biased upward).
export function weeklyBuckets(transactions: UtilitySpendTransaction[], windowDays: number): { weekStarts: string[]; values: number[] } {
  const weekCount = Math.max(1, Math.floor(windowDays / 7));
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const values = new Array(weekCount).fill(0);
  const weekStarts: string[] = [];
  for (let i = weekCount - 1; i >= 0; i -= 1) {
    weekStarts.push(new Date(now - (i + 1) * weekMs).toISOString());
  }
  for (const transaction of transactions) {
    const age = now - new Date(transaction.created_at).getTime();
    const weekIndexFromEnd = Math.floor(age / weekMs);
    const index = weekCount - 1 - weekIndexFromEnd;
    if (index >= 0 && index < weekCount) values[index] += transaction.amount;
  }
  return { weekStarts, values };
}
