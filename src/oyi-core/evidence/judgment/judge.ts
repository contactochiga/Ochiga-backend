import { randomUUID } from "node:crypto";
import { ASSESSMENT_TTL_MS } from "../../context/conversationAssessmentContext";
import type { CompactEvidencePlanState } from "../planner/types";
import { buildEvidenceIndex, type EvidenceIndex } from "./evidenceIndex";
import { contextStatements, judgeDeterministic } from "./deterministic";
import { describe, levelOf } from "./dominance";
import { buildProviderRequest, withProviderDeadline, type JudgmentProvider, type ProviderRanked } from "./provider";
import { adoptProposal, validateResult, type ValidationContext } from "./validator";
import { composeJudgmentText, evidenceBasis } from "./compose";
import type { Candidate, DerivedRanking, JudgmentOutcome, JudgmentResult, RankedItem } from "./types";

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
// The one explicit count a user can ask for ("top three", "which two"). Not a reinterpretation of the prompt.
export function requestedTopN(question: string): number | null {
  const m = /\b(?:top|which|these|best)\s+(two|three|four|five|\d)\b/i.exec(question) || /\b(two|three|four|five)\s+(?:things|items|issues|leads|opportunities|projects|priorities)\b/i.exec(question);
  if (!m) return null; const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]); return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

export const JUDGMENT_PROVIDER_TIMEOUT_MS = Number(process.env.OYI_JUDGMENT_TIMEOUT_MS) > 0 ? Number(process.env.OYI_JUDGMENT_TIMEOUT_MS) : 6000;
// A derived ranking artifact is minted only for a genuine ranking request. A comparison answers, but never creates an artifact:
// its pair is "the two items I took from the records", which is not necessarily the pair the user meant, and a later ordinal
// ("the second one") must not resolve against it.
const RANKING_OBJECTIVES = new Set(["prioritize", "compare"]);

export type JudgeArgs = {
  state: CompactEvidencePlanState; objective: string; question: string; surface: string;
  previous: DerivedRanking | null; provider: JudgmentProvider | null; providerTimeoutMs?: number; now?: () => number;
};

function businessFacts(index: EvidenceIndex): string[] {
  const out: string[] = [];
  const by = new Map<string, Candidate[]>(); for (const c of index.candidates.filter(c => c.needs_comparative_judgment)) by.set(c.source_key, [...(by.get(c.source_key) || []), c]);
  for (const [key, list] of by) {
    const q = list.filter(c => levelOf(c, "readiness") === "qualified").length, early = list.filter(c => levelOf(c, "readiness") === "early").length;
    const noun = key.startsWith("crm.leads") ? ["lead", "leads"] : key.startsWith("crm.opp") ? ["opportunity", "opportunities"] : key.startsWith("development") ? ["development project", "development projects"] : ["report", "reports"];
    out.push(`${list.length} ${noun[list.length === 1 ? 0 : 1]} read${q || early ? ` (${q} recorded as qualified, ${early} as new)` : ""}`);
  }
  return out;
}

// The derived artifact records what the answer PRESENTED, in the order presented: that is the human referent of "the second one".
// Only candidates the text actually names are included, with safe references, the recorded rationale and compact typed factors.
function artifactFor(r: JudgmentResult, a: JudgeArgs, basis: DerivedRanking["basis"], now: number, index: EvidenceIndex): DerivedRanking | null {
  const byId = new Map(index.candidates.map(c => [c.cid, c]));
  const shown = (r.presented || []).filter(p => byId.has(p.cid));
  if (!shown.length) return null;
  const perGroup = new Map<string, number>();
  const rankedById = new Map((r.ranking || []).map(i => [i.cid, i]));
  const items: DerivedRanking["items"] = shown.map(p => {
    const c = byId.get(p.cid)!, ranked = rankedById.get(p.cid);
    const n = (perGroup.get(p.group) || 0) + 1; perGroup.set(p.group, n);
    const state = r.candidates.find(x => x.cid === p.cid)?.state;
    const factors = ranked ? ranked.factors : c.factors.filter(f => ["lifecycle", "importance", "time_pressure"].includes(f.dimension)).map(f => ({ dimension: f.dimension, level: f.level }));
    return { rank: n, tier: ranked ? ranked.tier : 0, ref: c.ref, rationale: ranked ? ranked.rationale : `${c.ref.label || "Item"}: ${describe(c).join(", ")}`, factors,
      group: p.group, ...(state ? { state } : {}), kind: c.kind, source_key: c.source_key, evidence: c.evidence.slice(0, 4) };
  });
  const type = items.some(i => i.group === "ranked") ? "ranking" : items.some(i => i.group === "compared") ? "comparison" : "assessment_set";
  return { v: 1, ranking_id: `rk-${randomUUID()}`, artifact_type: type, ordered: type === "ranking", assessment_id: r.assessment_id, objective: r.objective, basis,
    scope_key: a.state.scope_key, subject_key: a.state.subject_key, surface: a.surface, source_keys: [...new Set(items.map(i => i.source_key!).filter(Boolean))],
    created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), expires_at: new Date(now + ASSESSMENT_TTL_MS).toISOString(),
    items, tied_groups: r.tied_groups.length, limitations: r.limitations.slice(0, 4), uncertainties: r.uncertainties.slice(0, 4), focus: null, parked: false, stale: null };
}

function explainFrom(prev: DerivedRanking, index: EvidenceIndex): JudgmentResult {
  return { v: 1, assessment_id: prev.assessment_id, objective: "explain", mode: "deterministic", status: "JUDGED", candidates: [], ranking: null, tied_groups: [],
    conclusion: `Here is why I ordered them that way, from the evidence recorded when I did.`, rationale: prev.items.map(i => `${i.rank}. ${i.rationale}.`).concat(prev.tied_groups ? ["Items in the same tier are equal on what is recorded."] : [], ["This explanation rests only on the evidence recorded when I ordered them, which was partial."]),
    uncertainties: [], limitations: prev.limitations, clarification: null, evidence_refs: [] };
}

export async function judgeAssessment(a: JudgeArgs): Promise<JudgmentOutcome> {
  const now = (a.now || Date.now)(); const t0 = now;
  const index = buildEvidenceIndex(a.state, now);
  const topN = requestedTopN(a.question);
  const missing = a.state.missing_mandatory;
  const rankingAllowed = missing.length === 0;
  const business = index.candidates.filter(c => c.needs_comparative_judgment);
  const typed = index.candidates.filter(c => !c.needs_comparative_judgment);
  const partial = a.state.contributions.some(c => c.completeness === "partial" || c.truncated || c.unobserved > 0);
  const wantsRanking = RANKING_OBJECTIVES.has(a.objective) || topN !== null;
  const vctx = (eligible: Candidate[], extra: string[] = []): ValidationContext => ({ index, eligible, topN, rankingAllowed, partial, question: a.question, planMissing: missing, alsoAssessmentIds: extra });
  let provider = { attempted: false, name: null as string | null, latency_ms: null as number | null, failure_class: null as string | null };
  let result: JudgmentResult; let basis: DerivedRanking["basis"] = "deterministic"; let failures: string[] = []; // diagnostics, including a rejected provider proposal
  let finalFailures: string[] = []; // validity of the result actually shown

  const reusable = a.previous && (a.previous.artifact_type ?? "ranking") === "ranking" && !a.previous.stale && !a.previous.parked && a.previous.subject_key === a.state.subject_key && a.previous.scope_key === a.state.scope_key && Date.parse(a.previous.expires_at) > now ? a.previous : null;
  if (a.objective === "explain" && reusable) {
    result = explainFrom(reusable, index);
    finalFailures = validateResult(result, vctx(typed, [reusable.assessment_id])); failures = finalFailures;
  } else if (business.length) { // includes an explain with nothing earlier to explain: it must not fall through to a "nothing found" conclusion
    const ctx = contextStatements(index, a.state);
    // A typed ordering is never allowed to answer for a set it cannot fully compare: the whole eligible set goes to comparative
    // judgment, or nothing is ranked.
    const proceed = rankingAllowed && a.provider;
    if (proceed) {
      provider = { attempted: true, name: a.provider!.name, latency_ms: null, failure_class: null };
      const request = buildProviderRequest({ index, candidates: business, objective: a.objective, surface: a.surface, question: a.question, topN, limits: [...a.state.cannot_conclude, ...ctx.uncertainties] });
      const pt0 = Date.now(); const raw = await withProviderDeadline(() => a.provider!.judge(request, { timeoutMs: a.providerTimeoutMs ?? JUDGMENT_PROVIDER_TIMEOUT_MS }), a.providerTimeoutMs ?? JUDGMENT_PROVIDER_TIMEOUT_MS);
      provider.latency_ms = Date.now() - pt0;
      if (!raw.ok) { provider.failure_class = raw.failure; failures = [`provider ${raw.failure}`]; result = bounded(a, index, ctx, business, "fallback_after_rejection"); }
      else {
        const adopted = adoptProposal(raw.value, vctx(business), { objective: a.objective });
        if (!adopted.ok) { provider.failure_class = "rejected_by_validator"; failures = adopted.failures; result = bounded(a, index, ctx, business, "fallback_after_rejection"); }
        else if (adopted.proposal.status !== "ranked" || !adopted.ranking.length) {
          result = bounded(a, index, ctx, business, "fallback_after_rejection");
          result.clarification = adopted.proposal.clarification; result.uncertainties = [...new Set([...result.uncertainties, ...adopted.proposal.uncertainties])]; provider.failure_class = `provider_${adopted.proposal.status}`;
        } else {
          const byId = new Map(business.map(c => [c.cid, c]));
          const items: RankedItem[] = adopted.ranking.map((r: ProviderRanked, i) => { const c = byId.get(r.cid)!; return { cid: r.cid, rank: r.rank, tier: i, ref: c.ref, rationale: `${c.ref.label || "Item"}: ${r.rationale}`, factors: c.factors.map(f => ({ dimension: f.dimension, level: f.level })), supporting: r.supporting.length ? r.supporting : c.evidence, counter: r.counter, uncertainties: r.uncertainties }; });
          result = { v: 1, assessment_id: index.assessment_id, objective: a.objective, mode: "provider", status: "JUDGED", candidates: [], ranking: items, tied_groups: [], conclusion: adopted.proposal.conclusion.startsWith("Based on") ? adopted.proposal.conclusion : `Based on the evidence available, ${adopted.proposal.conclusion.charAt(0).toLowerCase()}${adopted.proposal.conclusion.slice(1)}`,
            rationale: partial ? ["This is not an all-clear: it covers only what I could read."] : [], uncertainties: [...new Set([...adopted.proposal.uncertainties, ...ctx.uncertainties])], limitations: ["These are bounded, supplied views, not the whole pipeline; an assessment from them is a recommendation, not an action."], clarification: adopted.proposal.clarification, evidence_refs: [...new Set(items.flatMap(i => i.supporting))] };
          basis = "provider"; result.presented = items.map(i => ({ cid: i.cid, group: "ranked" as const }));
        }
      }
    } else result = bounded(a, index, ctx, business, "bounded_no_provider");
    finalFailures = validateResult(result, vctx(business)); failures = failures.concat(finalFailures);
  } else {
    result = judgeDeterministic({ index, state: a.state, objective: a.objective, topN, previous: reusable, asksToExplain: a.objective === "explain", wantsRanking });
    if (business.length) { result.limitations = [...result.limitations, ...businessFacts(index).map(f => `${f}.`)]; }
    if (!rankingAllowed && result.ranking) { result.ranking = null; result.tied_groups = []; result.limitations.push("I did not rank anything because mandatory evidence is missing or unavailable."); result.status = "BOUNDED"; }
    finalFailures = validateResult(result, vctx(typed)); failures = finalFailures;
  }
  // Any validator failure on the FINAL result degrades it: a bounded statement, never a repaired or partial judgment.
  let ok = finalFailures.length === 0;
  if (!ok && result.mode !== "fallback_after_rejection") {
    const ctx = contextStatements(index, a.state);
    result = bounded(a, index, ctx, business, "fallback_after_rejection");
    let again = validateResult(result, vctx(business));
    // If even the bounded statement fails (e.g. a record's own text smuggles a promise), say nothing about any candidate at all.
    if (again.length) { failures = failures.concat(again.map(x => `fallback: ${x}`)); result = minimal(a, index); again = validateResult(result, vctx(business)); }
    ok = again.length === 0; failures = failures.concat(again.map(x => `minimal: ${x}`));
    provider.failure_class = provider.failure_class ?? "validator_failure";
  } else if (!ok) { ok = false; }
  if (result.mode === "fallback_after_rejection" && provider.failure_class === null) provider.failure_class = "validator_failure";
  if (result.ranking && !(ok && wantsRanking && rankingAllowed)) result = { ...result, ranking: null, tied_groups: [], presented: (result.presented || []).filter(p => p.group !== "ranked" && p.group !== "compared") };
  // IQ-5: whatever the validated answer names is the conversational referent (a ranking, a compared pair, or the items needing
  // attention), kept as ONE derived artifact. It never claims an order the judgment did not establish (`ordered` is false for the latter two).
  const artifact = ok && result.status === "JUDGED" ? artifactFor(result, a, basis, now, index) : null;
  const text = composeJudgmentText(result, a.state);
  return { result, text, ranking_artifact: artifact, validation: { ok, failures: failures.slice(0, 12) }, provider, candidate_count: index.candidates.length,
    evidence_source_count: index.sources.length, latency_ms: Math.max(0, (a.now || Date.now)() - t0) };
}

function typedFacts(index: EvidenceIndex): string[] {
  const typed = index.candidates.filter(c => !c.needs_comparative_judgment && levelOf(c, "lifecycle") !== "historical").slice(0, 4);
  return typed.length ? [`Recorded as open: ${typed.map(c => `${c.ref.label || "item"} (${describe(c).join(", ")})`).join("; ")} (listed, not ranked against the others).`] : [];
}

function minimal(a: JudgeArgs, index: EvidenceIndex): JudgmentResult {
  return { v: 1, assessment_id: index.assessment_id, objective: a.objective, mode: "fallback_after_rejection", status: "BOUNDED", candidates: [], ranking: null, tied_groups: [],
    conclusion: `Based on the evidence available, I could not produce a safe judgment from the ${index.sources.length} source${index.sources.length === 1 ? "" : "s"} I read, so I am not drawing a conclusion or ranking anything.`,
    rationale: ["This covers only what I could read."], uncertainties: [], limitations: ["The records contain text I cannot safely repeat."], clarification: null, evidence_refs: [] };
}

function bounded(a: JudgeArgs, index: EvidenceIndex, ctx: { facts: string[]; uncertainties: string[] }, business: Candidate[], mode: JudgmentResult["mode"]): JudgmentResult {
  const facts = businessFacts(index);
  const noOrdering = a.objective === "explain" ? ["I have not ordered these yet, so there is no earlier ordering to explain."] : [];
  const why = mode === "fallback_after_rejection" ? "A comparative judgment could not be produced safely, so I am not ranking these." : "Ranking these takes comparative judgment on their recorded notes, which I do not have available right now, so I am not ranking them.";
  return { v: 1, assessment_id: index.assessment_id, objective: a.objective, mode, status: "BOUNDED", candidates: [], ranking: null, tied_groups: [],
    conclusion: facts.length ? `Based on the evidence available, I can tell you what is recorded but not put it in order. ${facts.join("; ")}.` : "Based on the evidence available, there is not enough to give a justified conclusion.",
    rationale: [...noOrdering, why, "I will not guess an order from age or claimed size alone.", "This covers only what I could read.", ...typedFacts(index)], uncertainties: ctx.uncertainties, limitations: business.length ? ["These are bounded, supplied views, not the whole pipeline."] : [], clarification: null, evidence_refs: [] };
}

export { evidenceBasis };
