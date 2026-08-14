import type { IntelligenceFact } from "../../contracts/canonicalConversation";

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

// Period-over-period comparison (e.g. "how does this week compare with last
// week?") — reuses the same period-bucketing the caller already resolved
// into two fact sets via two temporal-scoped loads; this only compares.
export function buildUtilitySpendingComparisonAnswer(currentFacts: IntelligenceFact[], previousFacts: IntelligenceFact[]) {
  const currentTotal = utilitySpendingRows(currentFacts).reduce((sum, row) => sum + Number(String(row.amount).replace(/[^0-9.-]+/g, "")), 0);
  const previousTotal = utilitySpendingRows(previousFacts).reduce((sum, row) => sum + Number(String(row.amount).replace(/[^0-9.-]+/g, "")), 0);
  if (!currentTotal && !previousTotal) return "I do not see confirmed utility spending for either period to compare.";
  const delta = currentTotal - previousTotal;
  const direction = delta > 0 ? "higher" : delta < 0 ? "lower" : "the same as";
  const deltaText = delta === 0 ? "" : ` (₦${Math.abs(delta).toLocaleString()} ${delta > 0 ? "more" : "less"})`;
  return `This period: ₦${currentTotal.toLocaleString()}. Previous period: ₦${previousTotal.toLocaleString()}. This period is ${direction} than the previous one${deltaText}.`;
}

function recordOfValue(fact: IntelligenceFact) {
  return recordOf(fact.value);
}

export function buildUtilityActiveAnswer(facts: IntelligenceFact[]) {
  if (!facts.length) return "I do not see any registered utility accounts for this scope.";
  const active = facts.filter((fact) => Boolean(recordOfValue(fact).active));
  if (!active.length) return `I see ${facts.length} registered utility${facts.length === 1 ? "" : "ies"}, but none are currently active and linked.`;
  const names = active.map((fact) => text(recordOfValue(fact).service_key)).slice(0, 6).join(", ");
  return `${active.length} of ${facts.length} registered utilities are active: ${names}.`;
}

export function buildUtilityTariffAnswer(facts: IntelligenceFact[]) {
  const configured = facts.filter((fact) => fact.truth_state !== "unavailable" && recordOfValue(fact).unit_cost);
  if (!configured.length) return "I do not see a configured tariff for this scope.";
  const lines = configured.slice(0, 5).map((fact) => {
    const value = recordOfValue(fact);
    return `${text(value.title || value.service_key)}: ${value.unit_cost} ${text(value.currency) || "NGN"} per ${text(value.unit_name) || "unit"}`;
  });
  return lines.join("; ") + ".";
}

export function buildUtilityPurchasesAnswer(facts: IntelligenceFact[]) {
  if (!facts.length) return "I do not see any utility purchase history for this scope.";
  const latest = facts[0];
  const value = recordOfValue(latest);
  const latestLine = `Most recent: ${text(value.service_key)} purchase of ${value.amount} ${text(value.currency) || "NGN"}, ${text(value.status)}${value.completed_at ? ` on ${text(value.completed_at)}` : ""}.`;
  return `${facts.length} utility purchase${facts.length === 1 ? "" : "s"} on record. ${latestLine}`;
}
