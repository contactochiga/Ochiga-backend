import type { CompactEvidencePlanState } from "../planner/types";
import { SOURCE_NOUN, entryFor } from "../planner/evidenceClasses";
import { missingDetail } from "../planner/bundle";
import { assessJvOpportunity } from "../../domains/development/developmentJv";
import { CANDIDATE_KIND } from "./evidenceIndex";
import { describe, levelOf, tiering } from "./dominance";
import type { EvidenceIndex } from "./evidenceIndex";
import type { DerivedRanking, JudgmentResult, RankedItem } from "./types";

const noun = (k: string) => SOURCE_NOUN[k] || k;

export type JudgeInput = { index: EvidenceIndex; state: CompactEvidencePlanState; objective: string; topN: number | null; previous: DerivedRanking | null; asksToExplain: boolean; wantsRanking: boolean };

// What the NON-candidate evidence says (devices, cameras, visitors, scenes, knowledge): context that shapes what can be
// concluded. Each statement is derived from typed fields and states exactly its own limits.
export function contextStatements(index: EvidenceIndex, state: CompactEvidencePlanState): { facts: string[]; uncertainties: string[] } {
  const facts: string[] = [], uncertainties: string[] = [];
  for (const k of state.contributions.filter(c => c.availability === "available")) {
    const n = noun(k.source_key);
    if (k.evidence_class === "security") {
      facts.push(k.record_count === 0 ? (k.completeness === "zero_proven" ? "no security incidents are recorded in the checked scope" : "no security incidents appeared in the part I could read") : `${k.record_count} security incident record${k.record_count === 1 ? "" : "s"} in the checked scope`);
    } else if (k.evidence_class === "visitors") {
      const active = k.material.filter(m => String(m.status).toLowerCase() === "active" && !(Date.parse(String(m.expires_at)) <= Date.now())).length;
      const expired = k.record_count - active;
      facts.push(`visitor access: ${active} currently active, ${Math.max(0, expired)} expired or inactive`);
      uncertainties.push("A visitor access record is permission, not evidence that anyone has arrived or left.");
    } else if (k.evidence_class === "cameras") {
      if (k.unobserved) uncertainties.push(`Camera state is unobservable for ${k.unobserved} camera${k.unobserved === 1 ? "" : "s"}: that is neither an outage nor normal operation.`);
      else facts.push(`${k.record_count} camera${k.record_count === 1 ? "" : "s"} with observed state`);
    } else if (k.evidence_class === "device_availability") {
      if (k.freshness === "stale") uncertainties.push(`The latest readings for ${k.record_count} device${k.record_count === 1 ? "" : "s"}${k.scope_label ? ` in the ${k.scope_label}` : ""} are stale, so they show no current condition and no failure.`);
      else if (k.unobserved) uncertainties.push(`${k.unobserved} device${k.unobserved === 1 ? " has" : "s have"} no observation yet.`);
      else facts.push(k.record_count === 0 ? (k.completeness === "zero_proven" ? `no devices are registered${k.scope_label ? ` in the ${k.scope_label}` : ""}` : "no devices appeared in the part I could read") : `${k.record_count} device${k.record_count === 1 ? "" : "s"}${k.scope_label ? ` in the ${k.scope_label}` : ""} with current availability`);
    } else if (k.evidence_class === "corporate_opportunity") {
      if (k.record_count) uncertainties.push("The opportunity details are your own statements and are not verified.");
    }
    if (k.truncated) uncertainties.push(`Only the first ${k.record_count} ${n} were read; more may exist.`);
    if (k.degraded.length) uncertainties.push(`Part of ${n} could not be read.`);
  }
  for (const c of state.classes.filter(c => c.status === "MANDATORY_MISSING_CAPABILITY" || (c.status === "OPTIONAL_UNAVAILABLE" && (c.reason || "").startsWith("known_product_debt")))) {
    uncertainties.push(`Not available in Oyi yet: ${entryFor(c.class)?.label || c.class}${missingDetail(c) ? ` (${missingDetail(c)})` : ""}.`);
  }
  for (const c of state.classes.filter(c => c.status === "MANDATORY_UNAVAILABLE")) uncertainties.push(`${entryFor(c.class)?.label || c.class} could not be read, so it was not assessed.`);
  return { facts, uncertainties: [...new Set(uncertainties)] };
}

// Osa: reuse the existing deterministic JV completeness logic, but ONLY its known/missing lists. Its strategic-alignment output
// reflects internal commercial criteria and must never reach a public caller.
const NOT_YET_USEFUL = new Set(["title_document_status"]);
const FRIENDLY: Record<string, string> = { jv_structure_offered: "the structure you have in mind (joint venture, lease or sale)", land_size: "the size of the land", opportunity_type: "whether it is land or an existing building", landowner_expectation: "what you expect from the arrangement", commercial_terms: "any commercial terms you have in mind", location: "the location", title_document_status: "the title/document status" };
export function osaAssessment(index: EvidenceIndex): { known: string[]; missing: string[]; present: boolean } | null {
  const item = [...index.entries.values()].find(e => e.kind === "item" && e.evidence_class === "corporate_opportunity");
  const source = [...index.entries.values()].find(e => e.kind === "source" && e.evidence_class === "corporate_opportunity");
  if (!source) return null;
  const f = (k: string) => { const v = item?.fields[`fact_${k}`]; return typeof v === "string" && v ? v : null; };
  const assess = assessJvOpportunity({ opportunityType: f("opportunity_type"), location: f("location"), landSize: f("land_size"), structureOffered: f("structure_offered"), landownerExpectation: f("landowner_expectation"), titleDocumentStatus: f("title_document_status"), commercialTerms: f("commercial_terms") });
  return { known: Object.entries(assess.known_facts).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`), missing: assess.missing_information.filter(m => !NOT_YET_USEFUL.has(m)).map(m => FRIENDLY[m] || m.replace(/_/g, " ")), present: Boolean(item) };
}

export function judgeDeterministic(i: JudgeInput): JudgmentResult {
  const { index, state } = i;
  const typed = index.candidates.filter(c => !c.needs_comparative_judgment);
  const business = index.candidates.filter(c => c.needs_comparative_judgment);
  const ctx = contextStatements(index, state);
  const live = typed.filter(c => levelOf(c, "lifecycle") !== "historical");
  const past = typed.filter(c => levelOf(c, "lifecycle") === "historical");
  // Compare puts resolved and active items on one footing (lifecycle is the first dimension, so an active item outranks a resolved one).
  const tiered = tiering(i.objective === "compare" ? typed : live);
  const limit = i.topN ?? tiered.length;
  const ranking: RankedItem[] = (i.wantsRanking ? tiered.slice(0, limit) : []).map(t => ({
    cid: t.candidate.cid, rank: t.rank, tier: t.tier, ref: t.candidate.ref, rationale: `${t.candidate.ref.label || "Item"}: ${describe(t.candidate).join(", ")}`,
    factors: t.candidate.factors.filter(f => ["lifecycle", "importance", "time_pressure"].includes(f.dimension)).map(f => ({ dimension: f.dimension, level: f.level })),
    supporting: t.candidate.evidence, counter: [], uncertainties: t.candidate.factors.some(f => f.dimension === "importance") ? [] : ["no priority or severity recorded"],
  }));
  const groups = new Map<number, string[]>(); for (const t of tiered) groups.set(t.tier, [...(groups.get(t.tier) || []), t.candidate.cid]);
  const tied = [...groups.values()].filter(g => g.length > 1);
  const limitations: string[] = [];
  if (business.length) limitations.push(`${business.length} lead/opportunity/project record${business.length === 1 ? "" : "s"} differ mainly in free-text notes, which I cannot weigh against each other without comparative judgment; I did not rank them.`);
  for (const k of state.contributions) if (k.availability === "available" && k.completeness === "partial" && k.scope_class === "office_permissioned_snapshot") { limitations.push("Office evidence is a bounded, supplied view, not the whole pipeline."); break; }
  const rationale: string[] = [];
  const candidates = typed.map(c => ({ cid: c.cid, ref: c.ref, state: (levelOf(c, "lifecycle") === "historical" ? "not_a_current_concern" : levelOf(c, "lifecycle") === "active" ? "needs_attention" : "cannot_confirm") as "needs_attention" | "not_a_current_concern" | "cannot_confirm", basis: describe(c).join(", "), evidence: c.evidence }));
  const shown = new Set(ranking.map(r => r.cid));
  const wait = [...tiered.filter(t => !shown.has(t.candidate.cid) && t.tier > 0 && levelOf(t.candidate, "lifecycle") !== "historical").map(t => t.candidate), ...past.filter(c => !shown.has(c.cid))];
  let conclusion: string;
  if (i.objective === "prioritize") {
    conclusion = ranking.length ? `Based on the evidence available, ${ranking[0].ref.label || "the first item"} comes first${tied.some(g => g[0] === ranking[0].cid) ? " (equal in recorded importance to others listed with it)" : ""}.` : typed.length ? "Based on the evidence available, nothing active needs ordering: the items found are resolved or past." : "The evidence I could read contains nothing to put in order.";
  } else if (i.objective === "compare") {
    const two = tiered.length >= 2 ? [tiered[0], tiered[1]] : null;
    conclusion = two ? (two[0].tier === two[1].tier ? `Based on the evidence available, ${two[0].candidate.ref.label} and ${two[1].candidate.ref.label} are equal on what is recorded; the evidence gives no basis to separate them.` : `Based on the evidence available, ${two[0].candidate.ref.label} outranks ${two[1].candidate.ref.label} on what is recorded.`)
      : typed.length ? "Based on the evidence available, only one active item was found, so there is nothing to compare it with." : "The evidence I could read contains nothing to compare.";
  } else {
    const checkedIssueSources = state.classes.some(c => c.class !== "corporate_opportunity" && CANDIDATE_KIND[c.class] && ["MANDATORY_COMPLETE_ENOUGH", "MANDATORY_PARTIAL", "OPTIONAL_GATHERED"].includes(c.status));
    conclusion = live.length ? `Based on the evidence available, ${live.length} item${live.length === 1 ? " needs" : "s need"} attention.`
      : typed.length ? "Based on the evidence available, nothing active was found among the items I could read; what is resolved is not a current concern."
      : checkedIssueSources && !business.length ? "Based on the evidence available, I found no active item in the part of the records I could read."
      : "Based on the evidence available, this is what is known and what is not.";
  }
  const presented: NonNullable<JudgmentResult["presented"]> = ranking.map(r => ({ cid: r.cid, group: (i.objective === "compare" ? "compared" : "ranked") as "compared" | "ranked" }));
  const operational = state.surface !== "public_corporate";
  // A comparison never claims to know which two things the user meant: it names the pair it took from the records. Resolving a
  // pronoun or ordinal ("this", "that one") to a specific earlier item is reference continuity, a later slice.
  if (i.objective === "compare" && tiered.length >= 2) rationale.push(`I took these two from the records I read (${tiered[0].candidate.ref.label} and ${tiered[1].candidate.ref.label}); if you meant different items, tell me which.`);
  const partialEvidence = state.contributions.some(c => c.availability === "available" && (c.completeness === "partial" || c.truncated || c.unobserved > 0 || c.freshness === "stale"));
  if (operational && (partialEvidence || !tiered.length || ctx.uncertainties.length || limitations.length)) rationale.push("This is not an all-clear: it covers only what I could read and observe, and part of it is partial or not current.");
  // Name what needs attention when the question was not itself a ranking request.
  if (!ranking.length && live.length) for (const c of live.slice(0, 5)) presented.push({ cid: c.cid, group: "attention" });
  if (!ranking.length && live.length) rationale.push(`Needs attention: ${live.slice(0, 5).map(c => `${c.ref.label || "item"} (${describe(c).join(", ")})`).join("; ")}.`);
  if (!i.wantsRanking && past.length) for (const c of past.slice(0, 4)) presented.push({ cid: c.cid, group: "past" });
  if (!i.wantsRanking && past.length) rationale.push(`Not a current concern (resolved or past): ${past.slice(0, 4).map(c => `${c.ref.label || "item"} (${describe(c).join(", ")})`).join("; ")}.`);
  if (wait.length && (i.objective === "prioritize" || i.objective === "compare")) for (const c of wait) presented.push({ cid: c.cid, group: "wait" });
  if (wait.length && (i.objective === "prioritize" || i.objective === "compare")) rationale.push(`Can wait or needs no action: ${wait.map(c => `${c.ref.label || "item"} (${describe(c).join(", ")})`).join("; ")}.`);
  rationale.push(...ctx.facts.map(f => f.charAt(0).toUpperCase() + f.slice(1) + "."));
  const osa = osaAssessment(index);
  if (osa) {
    conclusion = osa.present ? "Based on what you have told me (which I have not verified), here is where the opportunity stands." : "I do not have any opportunity details from you yet.";
    if (osa.known.length) rationale.push(`What you have told me: ${osa.known.join("; ")}.`);
    if (osa.missing.length) rationale.push(`To take a first look it would help to know: ${osa.missing.join("; ")}.`);
    rationale.push("This is a view of how complete the information is, not an assessment of eligibility; I cannot guarantee any outcome or return, and nothing here commits Ochiga to pursue anything.");
  }
  return {
    v: 1, assessment_id: index.assessment_id, objective: i.objective, mode: "deterministic", status: ranking.length || candidates.length || ctx.facts.length || osa ? "JUDGED" : "BOUNDED",
    candidates, ranking: ranking.length ? ranking : null, tied_groups: tied, conclusion, rationale, uncertainties: ctx.uncertainties, limitations, clarification: null,
    evidence_refs: [...new Set([...typed.flatMap(c => c.evidence)])], presented,
  };
}
