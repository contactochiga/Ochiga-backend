import type { EvidenceIndex } from "./evidenceIndex";
import { levelOf } from "./dominance";
import type { Candidate, JudgmentResult } from "./types";
import type { ProviderProposal, ProviderRanked } from "./provider";

// Deterministic validation around EVERY judgment result. Hallucinated candidates, invented evidence references, unavailable
// sources stated as fact, promises, actions and "I checked everything" claims are rejected, never repaired.
const ACTION_OR_PROMISE = /\b(?:i(?:'ll| will| have| am going to)\s+(?:send|call|email|book|schedule|approve|create|execute|change|turn|switch|submit|pursue|proceed|commit)|we(?:'ll| will)\s+(?:pursue|proceed|commit|call|contact)|has been (?:sent|booked|approved|scheduled|created|executed)|guarantee[sd]?|promise[sd]?|assured?|definitely will|will definitely)\b/i;
const COVERAGE_CLAIM = /\b(?:i (?:have )?checked everything|everything (?:is|looks) (?:fine|ok|okay|secure|safe)|all (?:clear|good|systems)|nothing (?:else )?(?:to worry|needs attention)|fully (?:checked|covered|verified)|complete(?:ly)? (?:covered|checked|verified))\b/i;
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/\S+|(?:\+?\d[\s().-]?){7,}/;

// A promise or action claim counts only when it is ASSERTED. "I cannot guarantee a return" and "I will not send anything" are the
// honest statements we want, so a negation shortly before the match clears it.
const NEGATION = /(?:\bcannot|\bcan't|\bcan not|\bdo not|\bdon't|\bwill not|\bwon't|\bnot|\bno|\bnever|\bnothing|\bwithout|\bunable to|\bneither|\bnor)\b[^.!?]{0,40}$/i;
export function assertsPromiseOrAction(prose: string): boolean {
  const re = new RegExp(ACTION_OR_PROMISE.source, "gi"); let m: RegExpExecArray | null;
  while ((m = re.exec(prose))) { const before = prose.slice(Math.max(0, m.index - 48), m.index); if (!NEGATION.test(before)) return true; }
  return false;
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [];
export function corpusFor(index: EvidenceIndex, extra: string[] = []): Set<string> {
  const set = new Set<string>();
  const add = (v: unknown) => { for (const w of words(String(v ?? ""))) set.add(w); };
  for (const e of index.entries.values()) { add(e.label); for (const v of Object.values(e.fields)) add(v); }
  for (const c of index.candidates) { add(c.ref.label); for (const s of c.signals) add(s.text); for (const f of c.factors) add(f.level.replace(/_/g, " ")); }
  extra.forEach(add);
  return set;
}

/** Numbers and proper-noun-like tokens in model prose must occur in the evidence corpus (the user's question included). */
export function ungroundedTokens(textValue: string, corpus: Set<string>, allowedSmall = 12): string[] {
  const bad: string[] = [];
  for (const n of textValue.match(/\d[\d,.]*/g) || []) { const v = Number(n.replace(/,/g, "")); if (!(Number.isFinite(v) && v >= 0 && v <= allowedSmall && Number.isInteger(v)) && !corpus.has(n.toLowerCase())) bad.push(n); }
  const sentences = textValue.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const toks = s.match(/[A-Za-z][A-Za-z0-9'-]*/g) || [];
    toks.slice(1).forEach(t => { if (/^[A-Z][A-Za-z0-9]{2,}/.test(t) && !corpus.has(t.toLowerCase())) bad.push(t); });
  }
  return [...new Set(bad)];
}

export type ValidationContext = { index: EvidenceIndex; eligible: Candidate[]; topN: number | null; rankingAllowed: boolean; partial: boolean; question: string; planMissing: string[]; alsoAssessmentIds?: string[] };

export function validateResult(r: JudgmentResult, c: ValidationContext): string[] {
  const f: string[] = []; const cids = new Set(c.index.candidates.map(x => x.cid));
  if (r.assessment_id !== c.index.assessment_id && !(c.alsoAssessmentIds || []).includes(r.assessment_id)) f.push("assessment_id does not belong to this evidence bundle");
  for (const ref of r.evidence_refs) if (!c.index.entries.has(ref)) f.push(`evidence reference ${ref} does not exist in this bundle`);
  for (const x of r.candidates) { if (!cids.has(x.cid)) f.push(`candidate ${x.cid} does not exist`); for (const e of x.evidence) if (!c.index.entries.has(e)) f.push(`candidate evidence ${e} does not exist`); }
  if (r.ranking) {
    if (!c.rankingAllowed) f.push("a ranking was produced although mandatory evidence is missing or unavailable");
    const seen = new Set<string>();
    r.ranking.forEach((it, i) => {
      if (!cids.has(it.cid)) f.push(`ranked candidate ${it.cid} does not exist`);
      else if (!c.eligible.some(e => e.cid === it.cid)) f.push(`ranked candidate ${it.cid} is not eligible for this judgment`);
      if (seen.has(it.cid)) f.push(`duplicate ranking entry ${it.cid}`); seen.add(it.cid);
      if (it.rank !== i + 1) f.push("ranks are not contiguous and ordered");
      for (const e of [...it.supporting, ...it.counter]) if (!c.index.entries.has(e)) f.push(`rationale cites ${e}, which does not exist`);
    });
    if (c.topN !== null && r.ranking.length > c.topN) f.push(`ranking has ${r.ranking.length} items but ${c.topN} were requested`);
    // A resolved/past item never outranks an active one.
    const byId = new Map(c.index.candidates.map(x => [x.cid, x]));
    for (let i = 0; i < r.ranking.length; i++) for (let j = i + 1; j < r.ranking.length; j++) {
      const a = byId.get(r.ranking[i].cid), b = byId.get(r.ranking[j].cid);
      if (a && b && levelOf(a, "lifecycle") === "historical" && levelOf(b, "lifecycle") === "active") f.push("a resolved item is ranked above an active one");
    }
  }
  const prose = [r.conclusion, ...r.rationale, ...(r.ranking || []).map(x => x.rationale), ...r.uncertainties, ...r.limitations].join(" \n ");
  if (assertsPromiseOrAction(prose)) f.push("the judgment states or promises an action, commitment or guarantee");
  if (COVERAGE_CLAIM.test(prose)) f.push("the judgment claims coverage or an all-clear the evidence does not support");
  if (CONTACT.test(prose)) f.push("the judgment introduces contact details or links");
  if (c.partial && r.status === "JUDGED" && !r.uncertainties.length && !r.limitations.length && !r.rationale.some(x => /not an all-clear|partial|bounded|only/i.test(x))) f.push("partial evidence is not disclosed");
  return f;
}

// Parse and validate a provider proposal into Core-owned fields. Nothing the model says about identity (labels, refs, ids)
// is trusted: those always come from the candidate index.
export function adoptProposal(raw: unknown, c: ValidationContext, base: { objective: string }): { ok: true; ranking: ProviderRanked[]; proposal: ProviderProposal } | { ok: false; failures: string[] } {
  const f: string[] = [];
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, failures: ["provider output is not an object"] };
  const allowed = new Set(["status", "ranking", "conclusion", "uncertainties", "clarification"]);
  for (const k of Object.keys(o)) if (!allowed.has(k)) f.push(`unexpected field ${k}`);
  const status = o.status; if (!["ranked", "insufficient", "clarify"].includes(String(status))) f.push("invalid status");
  const ranking = Array.isArray(o.ranking) ? o.ranking as any[] : (f.push("ranking is not an array"), []);
  if (ranking.length > 10) f.push("ranking too long");
  const strs = (v: unknown, max: number, what: string) => Array.isArray(v) && v.length <= 8 && v.every(x => typeof x === "string" && x.length <= max) ? v as string[] : (f.push(`${what} is malformed`), []);
  const items: ProviderRanked[] = ranking.map((it, i) => {
    if (!it || typeof it !== "object") { f.push(`ranking[${i}] is not an object`); return null as any; }
    for (const k of Object.keys(it)) if (!["cid", "rank", "rationale", "supporting", "counter", "uncertainties"].includes(k)) f.push(`ranking[${i}] has unexpected field ${k}`);
    if (typeof it.cid !== "string" || !Number.isInteger(it.rank) || typeof it.rationale !== "string" || it.rationale.length > 240) f.push(`ranking[${i}] is malformed`);
    return { cid: String(it.cid), rank: Number(it.rank), rationale: String(it.rationale || ""), supporting: strs(it.supporting, 12, "supporting"), counter: strs(it.counter, 12, "counter"), uncertainties: strs(it.uncertainties, 160, "uncertainties") };
  });
  if (typeof o.conclusion !== "string" || o.conclusion.length > 320) f.push("conclusion is malformed");
  const uncertainties = strs(o.uncertainties, 200, "uncertainties");
  if (!(o.clarification === null || typeof o.clarification === "string")) f.push("clarification is malformed");
  if (f.length) return { ok: false, failures: f };
  // Structural proof BEFORE anything is dereferenced: every cid exists and is eligible, none repeats, ranks are 1..n in order,
  // the requested top-N is respected, and every cited evidence reference was issued from this bundle.
  const seen = new Set<string>();
  items.forEach((it, i) => {
    if (!c.index.candidates.some(x => x.cid === it.cid)) f.push(`ranked candidate ${it.cid} does not exist`);
    else if (!c.eligible.some(x => x.cid === it.cid)) f.push(`ranked candidate ${it.cid} is not eligible for this judgment`);
    if (seen.has(it.cid)) f.push(`duplicate ranking entry ${it.cid}`); seen.add(it.cid);
    if (it.rank !== i + 1) f.push("ranks are not contiguous and ordered");
    for (const e of [...it.supporting, ...it.counter]) if (!c.index.entries.has(e)) f.push(`rationale cites ${e}, which does not exist`);
  });
  if (c.topN !== null && items.length > c.topN) f.push(`ranking has ${items.length} items but ${c.topN} were requested`);
  if (!c.rankingAllowed && items.length) f.push("a ranking was produced although mandatory evidence is missing or unavailable");
  if (f.length) return { ok: false, failures: [...new Set(f)] };
  const corpus = corpusFor(c.index, [c.question, base.objective]);
  for (const it of items) {
    for (const t of ungroundedTokens(it.rationale, corpus)) f.push(`rationale mentions "${t}", which is not in the evidence`);
    for (const e of [...it.supporting, ...it.counter]) { const ent = c.index.entries.get(e); if (!ent) f.push(`rationale cites ${e}, which was not provided`); }
    for (const u of it.uncertainties) for (const t of ungroundedTokens(u, corpus)) f.push(`uncertainty mentions "${t}", which is not in the evidence`);
  }
  for (const t of ungroundedTokens(String(o.conclusion), corpus)) f.push(`conclusion mentions "${t}", which is not in the evidence`);
  for (const u of uncertainties) for (const t of ungroundedTokens(u, corpus)) f.push(`uncertainty mentions "${t}", which is not in the evidence`);
  if (f.length) return { ok: false, failures: f };
  return { ok: true, ranking: items, proposal: { status: status as ProviderProposal["status"], ranking: items, conclusion: String(o.conclusion), uncertainties, clarification: (o.clarification as string | null) ?? null } };
}
