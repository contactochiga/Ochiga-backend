import { ASSESSMENT_TTL_MS, isAssessmentInformation, type ConversationAssessmentContext } from "../../context/conversationAssessmentContext";
import type { DerivedRanking } from "../judgment/types";
import { assertsPromiseOrAction } from "../judgment/validator";
import { composeNonResolution, composeReferenceAnswer, isExpired, resolveDerivedReference, type RawSetFacts } from "./derivedReference";

// The nouns a raw result set of a given domain answers to. Used only to decide whether "the second lead" names a raw list.
const DOMAIN_NOUNS: Record<string, string[]> = {
  crm: ["lead", "opportunity"], office_development: ["project"], corporate_development: ["project"], office_reports: ["report"], office_tasks: ["task"],
  office_meetings: ["meeting"], office_support: ["issue", "ticket", "request"], maintenance: ["issue", "request", "ticket", "problem"], security: ["incident", "issue"],
};
export const rawSetFacts = (set: { created_at: string; domain: string } | null | undefined): RawSetFacts => set ? { created_at: set.created_at, domain: set.domain, object_nouns: DOMAIN_NOUNS[set.domain] || [] } : null;

export type DerivedTurnArgs = {
  text: string; previous: ConversationAssessmentContext | null; surface: string; now: number; raw: RawSetFacts;
  scopeBinding: string; authorised: (sourceKeys: string[]) => boolean;
};
export type DerivedTurnResult =
  | { handled: false; why: string }
  | { handled: true; outcome: string; answer: string; assessment: ConversationAssessmentContext };

// Material information that arrives while a derived artifact is active does not delete it: the artifact is marked stale (needs
// reassessment) and the earlier assessment stays explainable as history. Nothing is recomputed here.
export function handleDerivedReferenceTurn(a: DerivedTurnArgs): DerivedTurnResult {
  const prev = a.previous; const art = prev?.derived_ranking;
  if (!prev || !art || prev.surface !== a.surface) return { handled: false, why: "no_artifact" };
  const touch = (artifact: DerivedRanking, extra: Partial<ConversationAssessmentContext> = {}): ConversationAssessmentContext => ({
    ...prev, ...extra, suspended: false, status: "assessment_pending", derived_ranking: { ...artifact, updated_at: new Date(a.now).toISOString() },
    updated_at: new Date(a.now).toISOString(), expires_at: new Date(a.now + ASSESSMENT_TTL_MS).toISOString() });
  const surfaceOk = (art.surface ?? a.surface) === a.surface;
  const scopeOk = surfaceOk && (art.scope_binding === undefined || art.scope_binding === a.scopeBinding);
  const authorityOk = a.authorised(art.source_keys || []);

  if (isAssessmentInformation(a.text) && !art.parked && scopeOk && authorityOk && !isExpired(art, a.now)) {
    const stale: DerivedRanking = art.stale ? art : { ...art, stale: { reason: "material_fact", at: new Date(a.now).toISOString() } };
    const kind = (art.artifact_type ?? "ranking") === "ranking" ? "ordering" : "assessment";
    return { handled: true, outcome: "material_fact_marked_stale", assessment: touch(stale, { pending_information: a.text.slice(0, 1000) }),
      answer: `I have noted that as your own statement; I have not verified it and it is not confirmed evidence. The ${kind} I gave earlier was made before it, and it may change that ${kind}. I have not reassessed it, so I will not treat the earlier ${kind} as current. I can still tell you why the items were set out as they were at the time.` };
  }
  const res = resolveDerivedReference(a.text, { artifact: art, now: a.now, raw: a.raw, scopeOk, authorityOk });
  if (res.status === "none" || res.status === "defer_raw") return { handled: false, why: res.status === "none" ? "no_reference" : res.reason };
  if (res.status !== "resolved") {
    const answer = composeNonResolution(res, art);
    // An expired or unauthorised artifact is never used again: it is dropped from state. Others stay as they were.
    const drop = res.status === "unavailable" && ["expired", "authority", "scope"].includes(res.reason);
    return { handled: true, outcome: `derived_reference_${res.status === "unavailable" ? res.reason : res.status}`, answer, assessment: drop ? { ...touch(art), derived_ranking: null } : touch({ ...art, updated_at: art.updated_at }) };
  }
  let answer = composeReferenceAnswer(art, res, a.text);
  if (assertsPromiseOrAction(answer)) answer = "I have that item in the earlier assessment, but its recorded text contains wording I cannot safely repeat, so I am not restating it.";
  const focus = res.items.length === 1 ? res.items[0].rank : res.how === "other_of_pair" ? res.items[0].rank : art.focus ?? null;
  return { handled: true, outcome: `derived_reference_${res.how}`, answer, assessment: touch({ ...art, focus, parked: false }) };
}
