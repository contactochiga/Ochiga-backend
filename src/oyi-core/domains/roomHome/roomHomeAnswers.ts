import { coverageGapClause } from "./aggregateContract";
import type { AggregateResult, AttentionItem } from "./aggregateContract";

function attentionClause(item: AttentionItem): string {
  return item.summary.replace(/\.$/, "");
}

function subjectFor(result: AggregateResult): string {
  if (result.scope_type === "home") return "Your home";
  const label = (result.scope_ref.label || "room").toLowerCase();
  return `The ${label}`;
}

// Deterministic composition, per §19: contributors -> coverage -> attention
// items -> stable/reassuring framing -> coverage gap -> done. No free-form
// LLM step decides what evidence exists; this only arranges facts already
// computed by the aggregator into concise prose (§20: 2-4 sentences, not a
// dump of every fact).
export function buildAggregateSummary(result: AggregateResult): string {
  const subject = subjectFor(result);
  const parts: string[] = [];

  if (result.overall_state === "critical") {
    parts.push(`${subject} needs immediate attention.`);
  } else if (result.overall_state === "warning") {
    parts.push(`${subject} has some issues that need attention.`);
  } else if (result.overall_state === "attention_needed") {
    parts.push(`${subject} is generally stable, but a few things need attention.`);
  } else if (result.overall_state === "partial") {
    parts.push(`Most things look stable in ${subject === "Your home" ? "your home" : subject.toLowerCase()} from the evidence I can access.`);
  } else {
    parts.push(`${subject} is generally stable.`);
  }

  const topAttention = result.attention_items.slice(0, 3);
  const stateNeedsAttentionCallout = result.overall_state === "critical" || result.overall_state === "warning" || result.overall_state === "attention_needed";
  if (topAttention.length) {
    parts.push(`${topAttention.map(attentionClause).join(". ")}.`);
    if (result.overall_state === "stable" || result.overall_state === "attention_needed" || result.overall_state === "partial") {
      parts.push("Everything else I could verify looks normal.");
    }
  } else if (!stateNeedsAttentionCallout) {
    parts.push("No issues were found in the evidence I could verify.");
  }

  const gap = coverageGapClause(result.contributors);
  if (gap) parts.push(gap);

  return parts.join(" ");
}

export function buildAggregateActivitySummary(result: AggregateResult): string {
  if (!result.facts.length) {
    const gap = coverageGapClause(result.contributors);
    return gap ? `I do not see any recent activity in the evidence I could verify. ${gap}` : "I do not see any recent activity in the evidence I could verify.";
  }
  const subject = subjectFor(result).toLowerCase();
  const recent = result.facts
    .filter((fact) => fact.truth_state !== "unavailable")
    .slice(0, 6)
    .map((fact) => fact.statement)
    .filter(Boolean);
  const gap = coverageGapClause(result.contributors);
  const lines = recent.length ? recent.join(" ") : "No notable changes were found in the evidence I could verify.";
  return gap ? `Here is what changed in ${subject}: ${lines} ${gap}` : `Here is what changed in ${subject}: ${lines}`;
}
