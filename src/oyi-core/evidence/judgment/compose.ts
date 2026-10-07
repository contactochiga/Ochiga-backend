import type { CompactEvidencePlanState } from "../planner/types";
import type { JudgmentResult } from "./types";

// User-visible text is composed by CORE from the validated structure. Provider prose reaches the user only as a validated,
// grounded rationale string; identities (labels) always come from the candidate index.
export function evidenceBasis(state: CompactEvidencePlanState): string {
  const usable = state.contributions.filter(c => c.availability === "available");
  const partial = usable.filter(c => c.completeness === "partial" || c.truncated || c.unobserved || c.freshness === "stale").length;
  return usable.length ? `Evidence basis: ${usable.length} source${usable.length === 1 ? "" : "s"} read${partial ? `, ${partial} of them partial or not current` : ""}.` : "Evidence basis: no source could be read.";
}

export function composeJudgmentText(r: JudgmentResult, state: CompactEvidencePlanState): string {
  const out: string[] = [r.conclusion];
  if (r.ranking?.length) {
    const lines = r.ranking.map(i => `${i.rank}. ${i.rationale}`);
    out.push(`In order: ${lines.join(" ")}`);
    if (r.tied_groups.length) out.push("Items in the same tier are equal on what is recorded; the evidence gives no basis to order them further.");
  }
  out.push(...r.rationale);
  if (r.clarification) out.push(r.clarification);
  if (r.uncertainties.length) out.push(`What I cannot confirm: ${r.uncertainties.slice(0, 4).join(" ")}`);
  if (r.limitations.length) out.push(...r.limitations.slice(0, 3));
  out.push(evidenceBasis(state));
  return out.join(" ");
}
