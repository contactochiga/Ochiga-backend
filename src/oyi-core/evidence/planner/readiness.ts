import { SOURCE_NOUN, entryFor } from "./evidenceClasses";
import type { CompactEvidencePlanState, Contribution } from "./types";

// Deterministic, honest statement of what was checked and what was not. This is NOT a judgment: it states
// evidence readiness and limits and leaves ranking/conclusions to the later reasoning slice. It never says
// "I need to check" for something the planner already checked.
const noun = (key: string) => SOURCE_NOUN[key] || key;

function phrase(c: Contribution): string {
  if (c.source_key === "corporate.partnerships.read") return "approved guidance is available";
  if (c.source_key === "corporate.opportunity.read") return c.record_count ? "you have shared details (unverified)" : "no details recorded yet";
  const unknownState = c.unobserved;
  const bits: string[] = [];
  if (c.record_count === 0) bits.push(c.completeness === "zero_proven" ? "none found in the checked scope" : "none in the part I could read");
  else {
    bits.push(String(c.record_count));
    if (c.truncated) bits.push("(first ones only; more may exist)");
    else if (c.completeness === "partial") bits.push("(partial view)");
    if (c.lifecycle.historical) bits.push(`(${c.lifecycle.historical} historical/resolved)`);
  }
  if (c.freshness === "stale") bits.push("(readings are stale)");
  if (unknownState) bits.push(`(${unknownState} with unknown state, not treated as ${c.evidence_class === "cameras" ? "offline" : "failed"})`);
  return bits.join(" ");
}

export function composeEvidenceReadiness(state: CompactEvidencePlanState): string {
  const usable = state.contributions.filter(c => c.availability === "available");
  const failed = state.contributions.filter(c => c.availability !== "available");
  const missing = state.classes.filter(c => c.status === "MANDATORY_MISSING_CAPABILITY");
  const unreadable = state.classes.filter(c => c.status === "MANDATORY_UNAVAILABLE" && !state.contributions.some(k => k.evidence_class === c.class));
  const allReused = state.stats.sources_attempted === 0 && state.stats.sources_reused > 0;
  const parts: string[] = [];
  parts.push(allReused ? "I am using the evidence I already gathered for this assessment, which is still current."
    : state.stats.sources_reused ? "I checked the evidence I am permitted to read, reusing what was already current." : usable.length || failed.length ? "I checked the evidence I am permitted to read for this." : "I could not read any evidence for this.");
  if (usable.length) parts.push(`What I found: ${usable.map(c => `${noun(c.source_key)}${c.scope_label ? ` in the ${c.scope_label}` : ""}: ${phrase(c)}`).join("; ")}.`);
  if (failed.length) parts.push(`Could not be read just now: ${failed.map(c => `${noun(c.source_key)}${c.availability === "denied" ? " (not available to you on this surface)" : c.availability === "unsupported_scope" ? " (not available for this scope)" : ""}`).join(", ")}.`);
  if (missing.length) parts.push(`Not available in Oyi yet: ${missing.map(c => `${entryFor(c.class)?.label || c.class}${entryFor(c.class)?.product_debt ? ` (${entryFor(c.class)!.product_debt})` : ""}`).join("; ")}. I have not checked these and cannot claim anything about them.`);
  if (unreadable.length) parts.push(`Not read: ${unreadable.map(c => `${entryFor(c.class)?.label || c.class} (${c.reason})`).join("; ")}.`);
  const reportedFailed = new Set(failed.map(c => c.evidence_class));
  const debtOptional = state.classes.filter(c => c.status === "OPTIONAL_UNAVAILABLE" && (c.reason || "").startsWith("known_product_debt"));
  if (debtOptional.length) parts.push(`Not available in Oyi yet: ${debtOptional.map(c => `${entryFor(c.class)?.label || c.class} (${(c.reason || "").replace(/^known_product_debt: /, "")})`).join("; ")}.`);
  const optionalMissing = state.optional_unavailable.filter(c => !reportedFailed.has(c) && !debtOptional.some(d => d.class === c));
  if (optionalMissing.length) parts.push(`Optional context not available: ${optionalMissing.map(c => entryFor(c)?.label || c).join(", ")}.`);
  if (state.cannot_conclude.length) parts.push(`From this I cannot conclude: ${state.cannot_conclude.slice(0, 3).join(" ")}`);
  parts.push("I have gathered this evidence but have not yet drawn conclusions from it or ranked anything.");
  return parts.join(" ");
}
