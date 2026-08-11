import type { IntelligenceFact } from "../../runtime/canonicalConversationRuntime";

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function utilityCategoryLabel(value: unknown) {
  const rawCategory = text(value) || "Utilities";
  return /electricity|power/i.test(rawCategory) ? "Electricity"
    : /water/i.test(rawCategory) ? "Water"
      : /internet|data/i.test(rawCategory) ? "Internet"
        : /gas/i.test(rawCategory) ? "Gas"
          : "Utilities";
}

export function utilitySpendingRows(facts: IntelligenceFact[]) {
  const totals = new Map<string, number>();
  for (const fact of facts) {
    const value = recordOf(fact.value);
    const isUtilityFact = fact.domain === "utilities"
      || /electricity|water|internet|utility|power|gas/i.test(`${value.category} ${value.description} ${value.type}`);
    if (!isUtilityFact) continue;
    if (text(value.direction).toLowerCase() === "credit") continue;
    const category = utilityCategoryLabel(value.utility_category || value.category || value.type || value.description);
    totals.set(category, (totals.get(category) || 0) + Math.abs(Number(value.amount || 0)));
  }
  return Array.from(totals.entries()).map(([category, amount]) => ({
    category,
    amount: `₦${amount.toLocaleString()}`,
    status: "confirmed",
  }));
}

export function buildUtilitySpendingAnswer(facts: IntelligenceFact[]) {
  const rows = utilitySpendingRows(facts);
  if (!rows.length) return "I could not confirm utility spending for the selected period from the available wallet and service records.";
  const total = rows.reduce((sum, row) => sum + Number(String(row.amount).replace(/[^0-9.-]+/g, "")), 0);
  return `You spent ₦${total.toLocaleString()} on confirmed utility transactions in the selected period. I did not perform any wallet, payment, or vending action.`;
}
