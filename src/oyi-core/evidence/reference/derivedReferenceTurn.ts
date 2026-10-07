import { ASSESSMENT_TTL_MS, isAssessmentInformation, type ConversationAssessmentContext } from "../../context/conversationAssessmentContext";
import { EVIDENCE_CLASSES } from "../planner/evidenceClasses";
import type { DerivedRanking } from "../judgment/types";
import { assertsPromiseOrAction } from "../judgment/validator";
import { addFact, activeFacts, affectedClasses, bindFact, classifyUpdate, makeFact, type ConversationFact } from "../reassessment/facts";
import { composeNotReassessed } from "../reassessment/reassess";
import { composeNonResolution, composeReferenceAnswer, isExpired, namedItems, parseDerivedReference, resolveDerivedReference, type RawSetFacts } from "./derivedReference";

// The nouns a raw result set of a given domain answers to. Used only to decide whether "the second lead" names a raw list.
const DOMAIN_NOUNS: Record<string, string[]> = {
  crm: ["lead", "opportunity"], office_development: ["project"], corporate_development: ["project"], office_reports: ["report"], office_tasks: ["task"],
  office_meetings: ["meeting"], office_support: ["issue", "ticket", "request"], maintenance: ["issue", "request", "ticket", "problem"], security: ["incident", "issue"],
};
export const rawSetFacts = (set: { created_at: string; domain: string } | null | undefined): RawSetFacts => set ? { created_at: set.created_at, domain: set.domain, object_nouns: DOMAIN_NOUNS[set.domain] || [] } : null;

const STOP = new Set(["resolved", "unresolved", "open", "closed", "fixed", "repaired", "secured", "worse", "still", "already", "again", "yet", "back", "online", "offline", "with", "from", "that", "this", "issue", "item", "lead", "wave11", "the", "and", "for", "have", "has", "been", "there", "their", "they", "says", "said", "now", "just", "very", "more", "much", "than", "then"]);
const tokens = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w.length >= 4 && !STOP.has(w)));
// New information concerns the artifact only if it points at it (a reference cue or an item's name) or shares a content word with one of its items.
export function informationConcernsArtifact(text: string, art: DerivedRanking): boolean {
  if (parseDerivedReference(text).any || namedItems(text, art).length) return true;
  const t = tokens(text);
  return art.items.some(i => [...tokens(i.ref.label || "")].some(w => t.has(w)));
}
// The evidence classes an artifact's items came from (via the sources they were read from).
export const artifactClasses = (a: DerivedRanking): string[] => Object.values(EVIDENCE_CLASSES).filter(c => c.sources.some(s => (a.source_keys || []).includes(s))).map(c => c.id);
const REASSESS_ASK = /\b(?:does|do|would|will|did|has|have)\b[^?]*\b(?:chang\w*|affect\w*|alter\w*|matter\w*)\b[^?]*\b(?:priorit\w*|recommend\w*|view|order|ranking|assessment|explanation|conclusion|picture|anything)\b|\bwhat changed\b|\bre-?assess\b|\bstill (?:come|rank|matter)/i;

export type DerivedTurnArgs = {
  text: string; previous: ConversationAssessmentContext | null; surface: string; now: number; raw: RawSetFacts; objective?: string | null;
  scopeBinding: string; authorised: (sourceKeys: string[]) => boolean;
};
export type DerivedTurnResult =
  | { handled: false; why: string; assessment?: ConversationAssessmentContext }
  | { handled: true; outcome: string; answer: string; assessment: ConversationAssessmentContext };

const kindOf = (a: DerivedRanking) => ((a.artifact_type ?? "ranking") === "ranking" ? "ordering" : "assessment");
const claim = (t: string) => `“${t.replace(/[.!\s]+$/, "").slice(0, 160)}”`;

// Material information that arrives while a derived artifact is active does not delete it. It is classified (IQ-2's "is this
// information" predicate plus a type), bound to the candidate it is about, stored as a USER-SUPPLIED, UNVERIFIED fact, and only the
// affected artifact is marked stale. Nothing is recomputed here: a reassessment is a separate, explicit step.
export function handleDerivedReferenceTurn(a: DerivedTurnArgs): DerivedTurnResult {
  const prev = a.previous; if (!prev || prev.surface !== a.surface) return { handled: false, why: "no_assessment" };
  const stamp = new Date(a.now).toISOString(), facts = prev.facts || [];
  const touch = (extra: Partial<ConversationAssessmentContext> = {}): ConversationAssessmentContext => ({
    ...prev, ...extra, suspended: false, status: "assessment_pending", updated_at: stamp, expires_at: new Date(a.now + ASSESSMENT_TTL_MS).toISOString() });
  const asksReassess = a.objective === "reassess" || (/\?\s*$/.test(a.text) && !/\b(?:do not|don'?t|never)\b/i.test(a.text) && REASSESS_ASK.test(a.text));
  let info = classifyUpdate(a.text, facts);
  // A bare pointer ("the second one") is a reference, not a detail.
  if (info.type === "non_material_detail" && parseDerivedReference(a.text).any) info = { type: "question", attributed: false };
  const art0 = prev.derived_ranking || null;

  // ---- no derived artifact: only honest statements about that, never a manufactured ordering ----
  if (!art0) {
    // Only when an ordering was WITHHELD (no comparative judgment available) do facts and reassessment questions get an honest "nothing to reorder"
    // answer; elsewhere the ordinary evidence-based flow already answers.
    const withheld = prev.evidence_plan && ["bounded_no_provider", "fallback_after_rejection"].includes(prev.judgment?.mode || "");
    if (!withheld) return { handled: false, why: "no_artifact" };
    if (asksReassess && !isAssessmentInformation(a.text)) return { handled: true, outcome: "reassess_no_prior_ordering", answer: composeNotReassessed("no_prior", null, activeFacts(facts)), assessment: touch() };
    if (["material_new_fact", "unverified_claim"].includes(info.type) && !/\b(?:actually|i meant|i mean)\b/i.test(a.text)) {
      const fact = makeFact(a.text, info, { status: "none", items: [], how: "no_artifact" }, facts, a.now);
      return { handled: true, outcome: "fact_recorded_no_ordering", assessment: touch({ facts: addFact(facts, fact), pending_information: a.text.slice(0, 1000) }),
        answer: `I have noted that as your own statement ${claim(a.text)}; I have not verified it and it is not confirmed evidence. There is no ordering for it to attach to or change: I have not ranked anything, so I am not recalculating anything.` };
    }
    return { handled: false, why: "no_artifact" };
  }

  const art = art0;
  const surfaceOk = (art.surface ?? a.surface) === a.surface;
  const scopeOk = surfaceOk && (art.scope_binding === undefined || art.scope_binding === a.scopeBinding);
  const authorityOk = a.authorised(art.source_keys || []);
  const live = scopeOk && authorityOk && !isExpired(art, a.now);
  const kind = kindOf(art);

  // ---- a statement of information about the active assessment ----
  if (live && !art.parked && info.type !== "question") {
    const concerns = informationConcernsArtifact(a.text, art);
    if (info.type === "hypothetical") return { handled: true, outcome: "hypothetical_not_applied", assessment: touch(), answer: `I am treating that as a hypothetical, not as a fact, so I have not stored it and the ${kind} I gave stands. If it were true it could bear on the items; tell me if it is actually the case.` };
    if (info.type === "opinion") return { handled: true, outcome: "opinion_noted", assessment: touch(), answer: `Noted as your preference or view. It is not evidence about the items, so the ${kind} I gave stands.` };
    if (info.type === "confirmation") return { handled: true, outcome: "confirmation_noted", assessment: touch(), answer: `That matches what I already hold, so nothing changes. It is still your own statement, not something I have verified.` };
    const artClasses = artifactClasses(art), binding = bindFact(a.text, art, artClasses);
    const classes = affectedClasses(a.text);
    const bears = binding.status === "bound" || classes.some(c => artClasses.includes(c)) || (concerns && classes.length > 0);
    // Information about something the assessment does not cover is left to the normal flow (it neither touches nor replaces this artifact).
    if (info.type !== "non_material_detail" && !bears) return { handled: false, why: "fact_unrelated_to_artifact" };
    if (info.type === "non_material_detail") {
      return { handled: true, outcome: "non_material_noted", assessment: touch(), answer: `Noted. As far as I can tell it does not bear on the items in the ${kind} I gave, so I have not changed or marked anything.` };
    }
    if (binding.status === "ambiguous") {
      const fact = makeFact(a.text, info, binding, facts, a.now);
      return { handled: true, outcome: "fact_target_ambiguous", assessment: touch({ facts: addFact(facts, fact) }),
        answer: `I have noted that as your own unverified statement, but I am not sure which item it concerns: ${binding.items.map(i => i.ref.label || "that item").join(" or ")}? I have not attached it to any of them and have not changed the ${kind}.` };
    }
    const fact = makeFact(a.text, info, binding, facts, a.now);
    const prior = fact.corrects ? facts.find(f => f.id === fact.corrects) : null;
    const stale: DerivedRanking = art.stale ? art : { ...art, stale: { reason: "material_fact", at: stamp } };
    const about = binding.status === "bound" ? ` I am treating it as being about ${binding.items[0].ref.label || "that item"}.` : ` It does not name a specific item, so I have kept it with the ${kind} as a whole.`;
    const lead = prior ? `I have replaced your earlier statement ${claim(prior.text)} with this one, and I no longer treat the earlier one as current.` : `I have noted that as your own statement ${claim(a.text)}; I have not verified it and it is not confirmed evidence.`;
    const recorded = binding.status === "bound" ? `${binding.items[0].ref.label || "That item"} keeps the status it is recorded with until the record itself is updated` : "what is recorded keeps its recorded status until the records themselves are updated";
    return { handled: true, outcome: prior ? "correction_supersedes_fact" : "material_fact_marked_stale", assessment: touch({ facts: addFact(facts, fact), pending_information: a.text.slice(0, 1000), derived_ranking: stale }),
      answer: `${lead}${about} It does not change any record by itself: ${recorded}. The ${kind} I gave earlier was made before it and may change; I have not reassessed it, so I will not treat the earlier ${kind} as current. Asking whether it changes the ${kind} reassesses only the evidence it could affect.` };
  }

  // A statement of fact is never resolved as a reference: if it could not be applied above (parked, expired, other scope), leave it to the normal flow.
  if (info.type !== "question" && !asksReassess) return { handled: false, why: "fact_not_applied" };
  // ---- reassessment request / a "now" question about a stale artifact ----
  const wantsHistory = parseDerivedReference(a.text).historical && prev.derived_history && !isExpired(prev.derived_history, a.now);
  if (!wantsHistory && live && !art.parked && asksReassess && !isAssessmentInformation(a.text)) {
    // A fact the ordinary flow already took in (IQ-2 pending information) counts as the new fact for this reassessment.
    let working = facts;
    if (!activeFacts(facts).length && prev.pending_information) {
      const pi = classifyUpdate(prev.pending_information, facts);
      if (["material_new_fact", "unverified_claim", "correction"].includes(pi.type)) {
        const artClasses = artifactClasses(art); const b = bindFact(prev.pending_information, art, artClasses);
        if (b.status !== "ambiguous" && (b.status === "bound" || affectedClasses(prev.pending_information).some(c => artClasses.includes(c)))) working = addFact(facts, makeFact(prev.pending_information, pi, b, facts, a.now));
      }
    }
    if (art.stale || activeFacts(working).length) return { handled: false, why: "reassess_requested", assessment: touch({ facts: working, pending_information: null, derived_ranking: art.stale ? art : { ...art, stale: { reason: "material_fact", at: stamp } } }) };
    return { handled: true, outcome: "reassess_nothing_new", assessment: touch(), answer: `Nothing new has been added since I gave that ${kind}, so there is nothing to reassess: it stands, as of when I gave it.` };
  }

  // ---- reference resolution (IQ-5), against the current artifact or, on a historical cue, the one it replaced ----
  const target = wantsHistory ? prev.derived_history! : art;
  const tScope = (target.surface ?? a.surface) === a.surface && (target.scope_binding === undefined || target.scope_binding === a.scopeBinding);
  const res = resolveDerivedReference(a.text, { artifact: target, now: a.now, raw: a.raw, scopeOk: tScope, authorityOk });
  if (res.status === "none" || res.status === "defer_raw") return { handled: false, why: res.status === "none" ? "no_reference" : res.reason };
  if (res.status === "unavailable" && res.reason === "stale_current" && !wantsHistory) return { handled: false, why: "reassess_requested" };
  if (res.status !== "resolved") {
    const answer = composeNonResolution(res, target);
    const drop = res.status === "unavailable" && ["expired", "authority", "scope"].includes(res.reason);
    return { handled: true, outcome: `derived_reference_${res.status === "unavailable" ? res.reason : res.status}`, answer, assessment: drop ? touch({ derived_ranking: wantsHistory ? art : null, derived_history: wantsHistory ? null : prev.derived_history ?? null }) : touch() };
  }
  let answer = composeReferenceAnswer(target, res, a.text);
  if (assertsPromiseOrAction(answer)) answer = "I have that item in the earlier assessment, but its recorded text contains wording I cannot safely repeat, so I am not restating it.";
  if (wantsHistory) return { handled: true, outcome: `historical_reference_${res.how}`, answer, assessment: touch() };
  const focus = res.items.length === 1 ? res.items[0].rank : res.how === "other_of_pair" ? res.items[0].rank : art.focus ?? null;
  return { handled: true, outcome: `derived_reference_${res.how}`, answer, assessment: touch({ derived_ranking: { ...art, updated_at: stamp, focus, parked: false } }) };
}
