import type { CompactEvidencePlanState } from "../evidence/planner/types";
import { SOURCE_NOUN } from "../evidence/planner/evidenceClasses";
import type { EvidenceIndex } from "../evidence/judgment/evidenceIndex";
import { describe, levelOf, tiering } from "../evidence/judgment/dominance";
import { contextStatements } from "../evidence/judgment/deterministic";
import type { Candidate, JudgmentResult } from "../evidence/judgment/types";
import { analyse } from "../interpretation/semanticObjective";
import { domainHits } from "../interpretation/domainVocabulary";
import { contentTokens, isHazardReport, type AnswerTarget } from "./answerTarget";
import { limitationAnswer } from "./limitationTarget";

// IQ-8: compose the LEAD of a judgment answer from the validated structure so that it answers the question that was asked (yes/no/unknown,
// reason, comparison, limitation, risk, list) instead of restating the state of the assessment. Everything stated comes from typed
// evidence fields, the context statements, or the result's own uncertainties. Nothing is invented; nothing promises or executes.

export type TargetedLead = { lead: string; support: string[] };
const GENERIC = new Set(["issue", "issues", "request", "requests", "item", "items", "problem", "problems", "ticket", "tickets", "lead", "leads", "report", "reports", "task", "tasks", "estate", "record", "records", "thing", "things", "one", "ones"]);
import { conceptTokens, isConcept } from "../interpretation/conceptLexicon";
const OPENISH = new Set([...conceptTokens("open"), "current"]);
const CLOSEDISH = new Set(conceptTokens("resolved"));
const lc = (s: string) => s.toLowerCase();
const sentence = (s: string) => { const t = s.trim(); return t ? (/[.!?]$/.test(t) ? t : t + ".") : t; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const labelTokens = (label: string | null) => contentTokens(analyse(label || "").tokens).filter(t => !/^wave\d*$/.test(t));

/** Candidates the question names, by distinctive content-word overlap with their labels (generic nouns never decide). */
export function namedCandidates(index: EvidenceIndex, questionTokens: string[]): Candidate[] {
  const q = new Set(contentTokens(questionTokens).filter(t => !GENERIC.has(t)));
  const scored = index.candidates.map(c => ({ c, n: labelTokens(c.ref.label).filter(t => !GENERIC.has(t) && q.has(t)).length })).filter(x => x.n > 0);
  const best = Math.max(0, ...scored.map(x => x.n));
  return scored.filter(x => x.n === best).map(x => x.c);
}
const bestUncertainty = (uncertainties: string[], questionTokens: string[]) => {
  const q = new Set(contentTokens(questionTokens));
  const scored = uncertainties.map(u => ({ u, n: contentTokens(analyse(u).tokens).filter(t => q.has(t)).length }));
  scored.sort((a, b) => b.n - a.n);
  return scored[0] && scored[0].n > 0 ? scored[0].u : null;
};
const missingCapability = (state: CompactEvidencePlanState) => state.classes.filter(c => c.status === "MANDATORY_MISSING_CAPABILITY" || (c.status === "OPTIONAL_UNAVAILABLE" && (c.reason || "").startsWith("known_product_debt"))).map(c => c.class);
const topicClasses = (tokens: string[]) => [...new Set(domainHits(tokens).map(h => h.domain))];
const stateWord = (c: Candidate) => levelOf(c, "lifecycle") === "historical" ? "resolved" : levelOf(c, "lifecycle") === "active" ? "open" : "of unclear status";
const facts = (c: Candidate) => describe(c).filter(x => !/^(open\/active|resolved or past)$/.test(x)).join(", ");
const withFacts = (c: Candidate) => `${c.ref.label || "that item"} is recorded as ${stateWord(c)}${facts(c) ? ` (${facts(c)})` : ""}`;

// Which evidence source a counting/listing question is about, from its content words (domain nouns, not phrases).
const SOURCE_BY_NOUN: Array<[RegExp, string]> = [[/^(?:leads?|prospects?)$/, "crm.leads"], [/^(?:opportunit\w*|deals)$/, "crm.opportunities"], [/^(?:projects?|developments?)$/, "development."], [/^reports?$/, "reports."], [/^tasks?$/, "office_tasks"], [/^(?:devices?|gadgets?|appliances?|sensors?)$/, "devices."], [/^(?:visitors?|guests?|passes|pass|invitations?)$/, "visitors."], [/^cameras?$/, "cameras"], [/^incidents?$/, "security."], [/^(?:requests?|tickets?|maintenance)$/, "maintenance."]];
function sourceFor(state: CompactEvidencePlanState, T: string[]) {
  for (const t of T) for (const [re, key] of SOURCE_BY_NOUN) if (re.test(t)) { const c = state.contributions.find(k => k.availability === "available" && k.source_key.includes(key)); if (c) return c; }
  return null;
}
const itemName = (m: Record<string, string | number | boolean | null>) => String(m.label ?? m.name ?? m.title ?? m.visitor_name ?? "").trim();

export function targetedLead(r: JudgmentResult, state: CompactEvidencePlanState, index: EvidenceIndex, target: AnswerTarget, question: string, extra: { hadPrevious?: boolean; userReports?: string[] } = {}): TargetedLead | null {
  const userReports = extra.userReports || [], hadPrevious = Boolean(extra.hadPrevious);
  const T = analyse(question).tokens, ctx = contextStatements(index, state), unc = [...new Set([...r.uncertainties, ...ctx.uncertainties])];
  const named = namedCandidates(index, T), business = index.candidates.filter(c => c.needs_comparative_judgment), typed = index.candidates.filter(c => !c.needs_comparative_judgment);
  const noJudgment = business.length > 0 && (r.mode === "bounded_no_provider" || r.mode === "fallback_after_rejection");
  const limitNote = "That takes comparative judgment on their recorded notes, which is not available right now.";
  const recordedFacts = (cs: Candidate[]) => cs.map(c => `${c.ref.label || "item"}: ${describe(c).join(", ")}${c.signals[0] ? ` (${c.signals[0].text})` : ""}`).join("; ");
  const supportOf = (extra: string[] = []) => [...extra];
  const missing = missingCapability(state);
  const notAvailAll = unc.filter(u => /^Not available in Oyi yet:/.test(u));
  const notAvail = bestUncertainty(notAvailAll, T) ?? notAvailAll[0]; // the unavailable source that matches what was asked, not merely the first
  const quote = (u: string) => lower(u.replace(/^Not available in Oyi yet:\s*/i, "").replace(/\.$/, ""));

  switch (target.response_intent) {
    case "STATUS": {
      const classes = topicClasses(T);
      const deviceU = unc.find(u => /readings for/.test(u) && /stale/.test(u)), cameraU = unc.find(u => /^Camera state is unobservable/.test(u));
      if (classes.includes("devices") && deviceU) return { lead: sentence(`I can't give their current state: ${lower(deviceU.replace(/\.$/, ""))}`), support: [] };
      if (classes.includes("cameras") && cameraU) return { lead: sentence(`I can't give the current state: ${lower(cameraU.replace(/\.$/, ""))}`), support: [] };
      const secF = ctx.facts.find(f => /security incident/.test(f));
      if (classes.includes("security") && secF && !named.length) return { lead: sentence(cap(secF)), support: [] };
      if (named.length === 1 && !named[0].needs_comparative_judgment) return { lead: sentence(withFacts(named[0])), support: [] };
      if (named.length === 1) { const c = named[0]; return { lead: sentence(`${c.ref.label} is recorded as ${c.factors.map(f => f.level).filter(Boolean).join(", ") || "in the records I read"}${c.signals[0] ? ` (${c.signals[0].text})` : ""}`), support: [] }; }
      return null;
    }
    case "COUNT": {
      const k = sourceFor(state, T); if (!k) return null;
      const staleAsked = T.some(t => isConcept(t, "stale")) && k.freshness === "stale";
      const openAsked = T.some(t => OPENISH.has(t)) && !T.some(t => CLOSEDISH.has(t));
      const overdueAsked = T.some(t => isConcept(t, "overdue"));
      let n = k.record_count; const noun = SOURCE_NOUN[k.source_key] || k.source_key;
      const fromSource = index.candidates.filter(c => c.source_key === k.source_key);
      if (fromSource.length && openAsked) n = fromSource.filter(c => levelOf(c, "lifecycle") === "active").length;
      if (fromSource.length && overdueAsked) n = fromSource.filter(c => levelOf(c, "time_pressure") === "overdue").length;
      const lead = `There ${n === 1 ? "is" : "are"} ${k.truncated ? "at least " : ""}${n} ${openAsked && fromSource.length ? "open " : overdueAsked && fromSource.length ? "overdue " : ""}${noun}${staleAsked ? " with stale readings" : ""}.`;
      return { lead, support: [] };
    }
    case "YES_NO_WITH_REASON": {
      const kind = target.yes_no?.kind ?? "state";
      if (T.some(t => ["first", "top", "priority", "ahead"].includes(t)) && T.includes("still") && named.length === 1) {
        if (r.ranking?.length) { const yes = r.ranking[0].cid === named[0].cid; return { lead: sentence(`${yes ? "Yes" : "No"} — ${yes ? `${named[0].ref.label} is first on what is recorded` : `${r.ranking[0].ref.label} comes ahead of ${named[0].ref.label} on what is recorded`}`), support: [] }; }
        const act = typed.filter(c => levelOf(c, "lifecycle") === "active");
        if (act.length === 1) { const yes = act[0].cid === named[0].cid; return { lead: sentence(`${yes ? "Yes" : "No"} — ${yes ? `${named[0].ref.label} is the only open item, so it is first` : `${act[0].ref.label} is the open item; ${named[0].ref.label} is not`}`), support: [] }; }
        return { lead: "I can't say whether it still comes first: I have not established an ordering.", support: [] };
      }
      if (kind === "inference") {
        const reported = T.some(t => ["statement", "says", "say", "said", "told", "claims", "claim", "report", "reported", "word", "his", "her", "their"].includes(t));
        if (reported && userReports.length) return { lead: sentence(`No — that is a reported statement (“${userReports[userReports.length - 1].replace(/[.!\s]+$/, "").slice(0, 160)}”), which I have not verified, so it does not establish it on its own`), support: [] };
        const safeAsk = T.some(t => ["safe", "secure", "fine", "okay", "ok", "problem", "problems", "alert", "alerts", "incident", "incidents"].includes(t));
        const u = bestUncertainty(unc, T) ?? (safeAsk ? null : unc[0] ?? null);
        const base = safeAsk ? "No — it only means nothing was recorded in the part I could read, which is not an all-clear" : "No — that does not establish it on the evidence I can read";
        return { lead: sentence(`${base}${u ? `: ${lower(u.replace(/\.$/, ""))}` : ""}`), support: supportOf(ctx.facts.map(f => cap(f) + ".")) };
      }
      if (kind === "capability") {
        if (T.some(t => ["verified", "verify", "mark", "confirm", "confirmed"].includes(t)) && T.some(t => ["just", "only", "statement", "report", "that", "claim"].includes(t))) return { lead: "No — I can't mark anything verified from a statement alone; verification needs evidence from the systems I can read.", support: [] };
        if (T.some(t => ["baseline", "snapshot", "history", "yesterday", "earlier", "previous"].includes(t))) return { lead: "No — I have no earlier snapshot to compare with, only the current state.", support: [] };
        const reason = notAvail ? `${lower(quote(notAvail))} is not available as an evidence source yet` : unc[0] ? lower(unc[0].replace(/\.$/, "")) : "I do not have a source for that";
        return { lead: sentence(`${T[0] === "do" || T[0] === "does" ? "No, I don't have that" : "No, I can't do that from what I have"} — ${reason}`), support: [] };
      }
      if (kind === "change") {
        if (r.ranking?.length || noJudgment === false && typed.length && r.objective !== "reassess") return null;
        if (!T.some(t => ["change", "changes", "changed", "alter", "affect"].includes(t))) return null;
        return { lead: "I can't say whether that changes anything: I have not established an ordering or explanation for it to change.", support: [] };
      }
      if (kind === "advice") {
        if (T.some(t => ["promise", "guarantee", "commit", "sign", "approve", "confirm", "authorise", "authorize", "pay", "send"].includes(t))) return { lead: "No — nothing in what I can read authorises that, and I can't promise or commit anything on anyone's behalf.", support: [] };
        const u = bestUncertainty(unc, T) ?? unc[0];
        if (noJudgment && T.some(t => ["better", "worth", "pursue", "commit", "proceed", "sign"].includes(t))) return { lead: `I can't give a justified yes or no on that: ${lower(limitNote)}`, support: [] };
        return { lead: sentence(`I can't tell from the evidence I have — nothing I can read links them${u ? `; ${lower(u.replace(/\.$/, ""))}` : ""}`), support: [] };
      }
      // state questions
      if (["do", "does", "is", "are", "have", "has"].includes(T[0]) && !named.length) {
        const ex = sourceFor(state, T);
        if (ex && (T.includes("any") || T.includes("have") || T.includes("there") || T.some(t => OPENISH.has(t) || ["overdue", "late", "pending"].includes(t)) || T[0] === "do" || T[0] === "does")) {
          const names = ex.material.map(itemName).filter(Boolean), noun = SOURCE_NOUN[ex.source_key] || ex.source_key;
          return ex.record_count > 0 ? { lead: sentence(`Yes — ${ex.record_count} ${ex.record_count === 1 ? noun.replace(/ies$/, "y").replace(/s$/, "") : noun}${names.length ? `: ${names.slice(0, 4).join(", ")}` : ""}`), support: [] } : { lead: sentence(`No — I found no ${noun} in what I read`), support: [] };
        }
      }
      if (noJudgment && business.length && !named.length) return { lead: sentence(`I can't judge that: ${lower(limitNote)}`), support: [businessSummary(index)] };
      if (T.some(t => ["first", "top", "priority", "ahead", "before"].includes(t)) && T.includes("still") && named.length === 1) {
        if (r.ranking?.length) { const yes = r.ranking[0].cid === named[0].cid; return { lead: sentence(`${yes ? "Yes" : "No"} — ${yes ? `${named[0].ref.label} is first on what is recorded` : `${r.ranking[0].ref.label} comes ahead of ${named[0].ref.label} on what is recorded`}`), support: [] }; }
        const act = typed.filter(c => levelOf(c, "lifecycle") === "active");
        if (act.length === 1) { const yes = act[0].cid === named[0].cid; return { lead: sentence(`${yes ? "Yes" : "No"} — ${yes ? `${named[0].ref.label} is the only open item, so it is first` : `${act[0].ref.label} is the open item; ${named[0].ref.label} is not`}`), support: [] }; }
        return { lead: sentence(`I can't say whether it still comes first: I have not established an ordering`), support: [] };
      }
      if (["could", "might", "may"].includes(T[0])) { const u0 = bestUncertainty(unc, T) ?? unc[0]; return { lead: sentence(`It could be, but I can't establish it from the evidence I have${u0 ? ` — ${lower(u0.replace(/\.$/, ""))}` : ""}`), support: [] }; }
      if (named.length === 1) {
        const c = named[0], life = levelOf(c, "lifecycle"), asksClosed = T.some(t => CLOSEDISH.has(t)), asksOpen = T.some(t => OPENISH.has(t));
        if (asksClosed || asksOpen) {
          const yes = asksClosed ? life === "historical" : life === "active";
          return { lead: sentence(`${yes ? "Yes" : "No"} — ${withFacts(c)}`), support: [] };
        }
      }
      const classes = topicClasses(T);
      const cameraU = unc.find(u => /^Camera state is unobservable/.test(u)), deviceU = unc.find(u => /readings for/.test(u) && /stale/.test(u)), visitorU = unc.find(u => /visitor access record is permission/.test(u));
      const asksCurrent = T.some(t => ["current", "date", "fresh", "latest", "recent"].includes(t));
      const secFact = ctx.facts.find(f => /security incident/.test(f));
      if (classes.includes("cameras") && cameraU) return { lead: sentence(`I can't tell — ${lower(cameraU.replace(/\.$/, ""))}`), support: [] };
      if (classes.includes("devices") && deviceU) return { lead: sentence(`${asksCurrent ? "No" : "I can't confirm that"} — ${lower(deviceU.replace(/\.$/, ""))}`), support: [] };
      if (classes.includes("visitors") && visitorU) return { lead: sentence(`I can't tell — ${lower(visitorU.replace(/\.$/, ""))}`), support: [] };
      if ((classes.includes("security") || T.some(t => ["incident", "incidents"].includes(t))) && secFact && /\bno security incidents\b/.test(secFact)) return { lead: sentence(`No — ${secFact}`), support: unc.length ? ["That is not an all-clear: " + lower(unc[0])] : [] };
      const u = bestUncertainty(unc, T) ?? unc[0];
      return { lead: sentence(`I can't confirm that from the evidence I have${u ? ` — ${lower(u.replace(/\.$/, ""))}` : ""}`), support: [] };
    }
    case "EXPLANATION": {
      if (r.mode === "deterministic" && /^Here is why I ordered them that way/.test(r.conclusion)) return null;
      if (T.some(t => ["reasoning", "ranking", "order", "ordering", "conditional", "recommendation", "say", "that"].includes(t)) && !named.length && !hadPrevious && !r.ranking?.length && (noJudgment || T.includes("reasoning"))) {
        return { lead: "I haven't ranked or recommended anything yet, so there is no ordering or reasoning of mine to explain.", support: [`What is recorded: ${business.length} lead/opportunity/project record${business.length === 1 ? "" : "s"}; ${limitNote}`] };
      }
      if (/^why\b/.test(T.join(" ")) && T.some(t => ["cannot", "can", "not", "unable"].includes(t)) && T.some(t => ["you"].includes(t))) {
        const u = bestUncertainty(unc, T) ?? unc[0]; if (u) return { lead: sentence(`Because ${lower(u.replace(/\.$/, ""))}`), support: [] };
      }
      // a named record that needs comparative judgment still has a RECORDED rationale (its own signals); say that, then be plain about what is not judged
      if (named.length === 1 && named[0].needs_comparative_judgment) {
        const c = named[0], askedSrc = SOURCE_BY_NOUN.find(([re]) => T.some(t => re.test(t)));
        const askedTok = askedSrc ? T.find(t => askedSrc[0].test(t)) : null;
        if (askedSrc && !String(c.source_key || "").includes(askedSrc[1])) return { lead: sentence(`I have no ${askedTok} record under that name — the only record I read is ${c.ref.label} (${SOURCE_NOUN[c.source_key] || c.source_key}: ${describe(c).join(", ")}), so I can't say why it counts that way`), support: [] };
        return { lead: sentence(`${c.ref.label} is on the list because of what is recorded: ${describe(c).join(", ")}${c.signals[0] && !describe(c).includes(c.signals[0].text) && !/days since/.test(c.signals[0].text) ? ` (${c.signals[0].text})` : ""}${c.signals.find(x => /days since/.test(x.text)) ? `; ${c.signals.find(x => /days since/.test(x.text))!.text}` : ""}`), support: [`I can't weigh how serious that is: ${lower(limitNote)}`] };
      }
      const pick = named.length ? named : index.candidates.filter(c => levelOf(c, "lifecycle") === "active").slice(0, 1);
      if (pick.length === 1 && !pick[0].needs_comparative_judgment) { const c = pick[0]; return { lead: sentence(`${c.ref.label || "That item"} matters because ${withFacts(c).replace(/^.*? is recorded as /, "it is recorded as ")}`), support: [] }; }
      const staleU = unc.find(u => /readings for/.test(u) && /stale/.test(u));
      if (staleU && topicClasses(T).includes("devices")) return { lead: sentence(`Because ${lower(staleU.replace(/\.$/, ""))}`), support: [] };
      const bare = T.filter(t => !["why", "not", "so", "then"].includes(t)).length === 0 || T.some(t => ["ranked", "ordered", "order", "ranking", "ordering", "priority", "reasoning", "recommend", "recommendation", "said"].includes(t));
      if (notAvail && !bare) return { lead: sentence(`I can't explain that: ${lower(quote(notAvail))} is not available as an evidence source yet`), support: [] };
      if (bare && (noJudgment || !hadPrevious)) return { lead: "I haven't ranked or recommended anything yet, so there is no ordering or reasoning of mine to explain.", support: [] };
      return null;
    }
    case "REFUSAL": return { lead: limitationAnswer(target, question), support: [] };
    case "COMPARISON": {
      const sides = target.compare_terms.length === 2 ? target.compare_terms.map(g => index.candidates.filter(c => labelTokens(c.ref.label).some(t => g.includes(t) && !GENERIC.has(t)))) : [];
      const pair = sides.length === 2 && sides[0].length && sides[1].length ? [sides[0][0], sides[1][0]] : (named.length === 2 ? named : null);
      if (pair && pair[0].cid !== pair[1].cid) {
        const [a, b] = pair;
        if (a.needs_comparative_judgment || b.needs_comparative_judgment) {
          return { lead: sentence(`I can't judge which of ${a.ref.label} and ${b.ref.label} is stronger: ${lower(limitNote)} What is recorded — ${recordedFacts([a, b])}`), support: [] };
        }
        const ordered = tiering([a, b]);
        if (ordered[0].tier === ordered[1].tier) return { lead: sentence(`${a.ref.label} and ${b.ref.label} are equal on what is recorded (${describe(a).join(", ")} versus ${describe(b).join(", ")}); the evidence gives no basis to separate them`), support: [] };
        const [w, l] = [ordered[0].candidate, ordered[1].candidate];
        return { lead: sentence(`${w.ref.label} comes ahead of ${l.ref.label} on recorded status and priority: it is ${describe(w).join(", ")}, while ${l.ref.label} is ${describe(l).join(", ")}. That orders what is recorded; it is not a judgment of which is worse or matters more`), support: [] };
      }
      if (sides.length === 2 && (sides[0].length === 0) !== (sides[1].length === 0)) {
        const found = (sides[0].length ? sides[0] : sides[1])[0], missingSide = (sides[0].length ? target.compare_terms[1] : target.compare_terms[0]).join(" ");
        return { lead: sentence(`I can't compare them: I only found ${found.ref.label} in the evidence I read, and nothing matching "${missingSide}"`), support: [] };
      }
      if (noJudgment) { const nm = target.compare_terms.map(g => g.filter(t => !["which", "one", "better", "worse", "stronger", "weaker", "best", "worst", "more", "most", "who", "ahead", "comes", "out", "serious", "bigger"].includes(t)).join(" ")).filter(Boolean); return { lead: sentence(`I can't compare ${nm.length === 2 ? `${nm[0]} and ${nm[1]}` : "these"} on judgment grounds: ${lower(limitNote)}`), support: [] }; }
      return null;
    }
    case "RANKING": case "ASSESSMENT": case "DIRECT_ANSWER": case "ADVICE": case "NEXT_STEP": {
      if (noJudgment && (target.response_intent === "RANKING" || ((target.response_intent === "ADVICE" || target.response_intent === "NEXT_STEP") && T.some(t => ["first", "which", "best", "most", "top"].includes(t))) || (target.response_intent === "ASSESSMENT" && /rank|order|first|best|matters?\b/.test(T.join(" "))))) {
        return { lead: sentence(`I can't put these in order: ordering ${business.length === 1 ? "this record" : "these records"} ${lower(limitNote.replace(/^That takes /, "takes "))}`), support: [businessSummary(index)] };
      }
      if (target.response_intent === "DIRECT_ANSWER" && T.some(t => ["since", "yesterday", "ago", "earlier", "last", "before"].includes(t)) && T.some(t => ["changed", "change", "different", "new"].includes(t))) {
        return { lead: "I can't say what changed: I have no earlier snapshot to compare the current records with, only the current state.", support: [] };
      }
      if (target.response_intent === "DIRECT_ANSWER" && T.includes("changes")) {
        const u = unc[0]; return { lead: sentence(`I can't say what would change${u ? ` — ${lower(u.replace(/\.$/, ""))}` : ""}. Until that is observable, nothing about the ranking should be treated as changed`), support: [] };
      }
      return null;
    }
    case "LIST": {
      const src = sourceFor(state, T);
      if (src && src.material.length && !T.some(t => ["unknown", "unresolved", "missing", "confirmation", "remains", "remain"].includes(t))) {
        const names = src.material.map(itemName).filter(Boolean);
        if (names.length) return { lead: sentence(`${cap(SOURCE_NOUN[src.source_key] || src.source_key)}${T.some(t => isConcept(t, "stale")) && src.freshness === "stale" && src.evidence_class === "device_availability" ? " with stale readings" : ""}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? `, and ${names.length - 8} more` : ""}`), support: [] };
      }
      if (T.some(t => isConcept(t, "stale")) && !src) { const st = state.contributions.filter(c => c.availability === "available" && c.freshness === "stale"); if (st.length) return { lead: sentence(`Stale: ${st.map(c => `the latest readings for ${c.record_count} ${SOURCE_NOUN[c.source_key] || c.source_key}`).join("; ")}`), support: [] }; }
      const miss = T.some(t => ["unknown", "unresolved", "missing", "confirmation", "remains", "remain"].includes(t));
      if (miss && unc.length) return { lead: sentence(`What I cannot confirm: ${unc.slice(0, 4).map(u => lower(u.replace(/\.$/, ""))).join("; ")}`), support: [] };
      if (T.includes("evidence") && T.includes("have")) return { lead: sentence(`I have read ${state.contributions.filter(c => c.availability === "available").map(c => `${c.record_count} ${SOURCE_NOUN[c.source_key] || c.source_key}`).join(", ") || "no usable source"}`), support: [] };
      const classes = topicClasses(T);
      const devices = state.contributions.find(c => c.evidence_class === "device_availability" && c.availability === "available");
      if (classes.includes("devices") && devices && devices.material.length) {
        const names = devices.material.map(m => String(m.label || m.name || "")).filter(Boolean);
        const stale = devices.freshness === "stale" || T.some(t => isConcept(t, "stale"));
        if (names.length) return { lead: sentence(`${stale ? "Devices with stale readings" : "Devices"}: ${names.join(", ")}`), support: [] };
      }
      const open = T.some(t => OPENISH.has(t));
      if (open || classes.includes("maintenance") || T.includes("open")) {
        const act = typed.filter(c => levelOf(c, "lifecycle") === "active");
        if (act.length) return { lead: sentence(`Still open: ${act.map(c => `${c.ref.label} (${describe(c).filter(x => x !== "open/active").join(", ")})`).join("; ")}`), support: [] };
      }
      return null;
    }
    case "SAFETY_RISK": {
      if (isHazardReport(question)) {
        const open = typed.filter(c => levelOf(c, "lifecycle") === "active").map(c => `${c.ref.label} (${describe(c).filter(x => x !== "open/active").join(", ") || "open"})`);
        return { lead: sentence(`This is an unverified report, and it could be safety-relevant: “${question.replace(/\s+/g, " ").trim().slice(0, 200)}”. I cannot confirm it from current evidence`), support: open.length ? [`What I can read: still open — ${open.join("; ")}.`] : [] };
      }
      const sec = ctx.facts.find(f => /security incident/.test(f)), live = typed.filter(c => levelOf(c, "lifecycle") === "active"), hedgeU = unc.filter(u => /Camera state|stale|unobserv|no observation|could not be read|Not available in Oyi/.test(u));
      if (named.length === 1 && !named[0].needs_comparative_judgment && T.some(t => ["worry", "worried", "concern", "concerned", "worrying", "risk", "risky", "danger", "dangerous", "unsafe"].includes(t))) {
        const c = named[0], isLive = levelOf(c, "lifecycle") === "active", others = live.filter(x => x.cid !== c.cid).map(x => `${x.ref.label} (${describe(x).filter(y => y !== "open/active").join(", ") || "open"})`);
        return { lead: sentence(`${isLive ? "Yes — it is still open" : "No — it is recorded as resolved"}: ${withFacts(c)}${others.length ? `; the open item is ${others.join("; ")}` : ""}`), support: [] };
      }
      const asksState = target.yes_no !== null && T.some(t => ["safe", "secure"].includes(t));
      const listLive = live.map(c => `${c.ref.label} (${describe(c).filter(x => x !== "open/active").join(", ") || "open"})`);
      if (asksState && T.includes("ignore") && live.length) return { lead: sentence(`No — ${withFacts(live[0])}, so I would not treat it as safe to ignore`), support: [] };
      const parts: string[] = [];
      if (sec) parts.push(cap(sec));
      if (listLive.length) parts.push(`The open item that could matter for safety: ${listLive.join("; ")}`);
      if (hedgeU.length) parts.push(`I cannot rule out anything else: ${lower(hedgeU[0].replace(/\.$/, ""))}`);
      if (!parts.length) return null;
      const lead = asksState && !listLive.length && hedgeU.length ? `I can't confirm that: ${lower(hedgeU[0].replace(/\.$/, ""))}` : parts.join(". ");
      return { lead: sentence(lead), support: [] };
    }
    case "LIMITATION": {
      if (noJudgment) return { lead: sentence(`I can't do that: ${lower(limitNote)}`), support: [businessSummary(index)] };
      const meas = T.find(t => ["temperature", "humidity", "noise", "decibels", "airflow", "pollution"].includes(t));
      if (meas) return { lead: sentence(`I don't have ${meas} data: no ${meas} sensor reading is available to me here`), support: [] };
      const u = notAvail ? `${cap(quote(notAvail))} is not available as an evidence source yet` : unc[0];
      return u ? { lead: sentence(`I can't answer that from what I can read — ${lower(u.replace(/\.$/, ""))}`), support: [] } : null;
    }
    default: return null;
  }
  function businessSummary(ix: EvidenceIndex) {
    const by = new Map<string, number>(); for (const c of ix.candidates.filter(c => c.needs_comparative_judgment)) by.set(c.source_key, (by.get(c.source_key) || 0) + 1);
    return `What is recorded: ${[...by].map(([k, n]) => `${n} ${SOURCE_NOUN[k] || k}`).join("; ")}.`;
  }
}
