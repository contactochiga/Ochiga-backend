import type { OisContext } from "../../../types/oisContext";
import type {
  CanonicalConversationRequest,
  IntelligenceFact,
} from "../../runtime/canonicalConversationRuntime";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";
import { loadWalletTransactionFacts } from "../wallet/walletEvidence";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
