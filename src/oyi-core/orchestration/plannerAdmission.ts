// IQ-9A6 R1: ONE explicit decision on whether the assessment evidence planner may own a turn. A parsed assessment objective alone is not enough.
// The planner owns a turn only when (1) the requested answer shape is a governed cognitive assessment (or the turn genuinely continues an existing one),
// (2) the planner has an applicable evidence class for the subject on this surface, and (3) no more specific governed capability or specialised truth path
// (action/communication result, confirmation state, refusal, clarification, capability discovery) already owns the request. Pure and structural: it reads
// no data, stores no prompt text and returns only a reason code that the orchestrator records as trace metadata.
import type { AnswerTarget } from "../response/answerTarget";

export type PlannerAdmissionInput = {
  surface: string;
  target: AnswerTarget | undefined;
  objective: string | null | undefined;          // parsed cognitive objective
  continuing: boolean;                           // a valid, unsuspended earlier assessment exists AND this turn is a follow-up to it
  mutationOrAction: boolean;                     // the turn is a governed action request
  subjectDomains: string[];                      // domains the question is about
  eligibleReadDomains: string[];                 // domains of reads the actor may use on this surface
  headDomainSupportedOnSurface: boolean;         // some enabled read for the head domain exists on this surface (even if this actor's scope is insufficient)
  headDomain: string | null;                     // head domain of the question's own noun concepts (not a lexical guess)
  conceptDomains: string[];                      // every domain the question's nouns name
  hasPublicObjective: boolean;                   // an established Osa opportunity objective exists in the thread
  specificCapability: { key: string; domain: string } | null; // an allowed, non-global read that supports the frame
};
export type PlannerAdmission = { admit: boolean; reason: string };

const ASSESSMENT_SHAPES = new Set(["RANKING", "COMPARISON", "ADVICE", "NEXT_STEP", "ASSESSMENT", "SAFETY_RISK", "EXPLANATION"]);
const SPECIALISED_SHAPES = new Set(["ACTION_RESULT", "CONFIRMATION_STATE", "CLARIFICATION", "REFUSAL", "CAPABILITY_DISCOVERY", "LIMITATION"]);
const RETRIEVAL_SHAPES = new Set(["LIST", "COUNT", "STATUS", "DIRECT_ANSWER", "YES_NO_WITH_REASON", "SUMMARY"]);
// Domains whose records belong to other surfaces, and domains for which the planner has no evidence class at all
const OTHER_SURFACE_DOMAINS = new Set(["visitors", "devices", "rooms", "maintenance", "security", "cameras", "wallet", "transactions", "utilities", "access"]);
const NO_PLANNER_CLASS_DOMAINS = new Set(["wallet", "transactions"]);
const JUDGMENT_OBJECTIVES = new Set(["prioritize", "compare", "advise"]);

export function plannerAdmission(i: PlannerAdmissionInput): PlannerAdmission {
  const shape = i.target?.response_intent ?? null;
  // a yes/no about what WOULD happen, or what follows from something, is a cognitive question, not a record lookup
  const yesNoKind = i.target?.yes_no?.kind ?? null;
  const retrievalShape = Boolean(shape && RETRIEVAL_SHAPES.has(shape)) && !(shape === "YES_NO_WITH_REASON" && !["state", "fact", "change"].includes(String(yesNoKind)));
  if (i.continuing) return { admit: true, reason: "continuation_of_existing_assessment" };
  if (i.mutationOrAction || i.target?.confirmation_kind === "action") return { admit: false, reason: "action_request_owned_by_governed_action_path" };
  if (shape && SPECIALISED_SHAPES.has(shape)) return { admit: false, reason: `specialised_answer_shape_${shape.toLowerCase()}` };
  if (i.surface === "public_corporate" && !i.hasPublicObjective) return { admit: false, reason: "no_established_public_objective" };
  if (retrievalShape && !JUDGMENT_OBJECTIVES.has(String(i.objective ?? "")) && i.specificCapability
    && i.headDomain === i.specificCapability.domain && new Set(i.conceptDomains).size === 1 && i.subjectDomains.includes(i.specificCapability.domain)) return { admit: false, reason: "specific_governed_capability_owns_retrieval" };
  // the question's head noun names a domain whose records belong to other surfaces and are not readable here: the planner has no class for it
  if (i.headDomain !== null && OTHER_SURFACE_DOMAINS.has(i.headDomain) && !i.eligibleReadDomains.includes(i.headDomain) && !i.headDomainSupportedOnSurface && i.specificCapability === null) return { admit: false, reason: "subject_not_available_on_surface" };
  if (i.subjectDomains.length > 0 && i.subjectDomains.every(d => NO_PLANNER_CLASS_DOMAINS.has(d)) && i.headDomain !== null) return { admit: false, reason: "no_applicable_evidence_class" };
  return { admit: true, reason: shape && ASSESSMENT_SHAPES.has(shape) ? "assessment_shape_with_evidence" : "assessment_objective_no_more_specific_owner" };
}
