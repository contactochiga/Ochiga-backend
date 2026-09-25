// Wave 8 Slice 4 -- Commercial Outcome Evaluator.
//
// Generalizes deviceOutcomeEvaluator.ts's own proven pattern (compare an
// intended target against fresh, independently re-queried evidence from
// the authority that already owns that fact) to the commercial domain:
// does Office's own Opportunity authority now show the pursuit having
// reached the commercial stage a Goal's target_entities.commercial_target_stage
// named.
//
// READ-ONLY: this module never writes anything, to either repository. It
// only compares (a) a target stage supplied by the caller against (b) an
// OfficeOpportunitySnapshot already fetched by officeOpportunityBridge.ts
// -- it performs no I/O itself, matching goalOutcomeEvaluator.ts's own
// pure-function shape.
//
// Office is authoritative. This module never infers commercial
// progression from reply/sentiment/delivery/workflow completion -- it
// only ever compares against the Opportunity's own real stage/status and
// stage-change history (Section 3/14 of the task).
import { commercialStageOrdinal } from "./commercialStageOrder";
import type { OfficeOpportunitySnapshot } from "../../ingress/officeOpportunityBridge";

export type CommercialOutcomeResult = "achieved" | "not_achieved" | "unverified";

// Section 13 -- distinct provenance classes, never blurred into one
// opaque "no" answer. "no_target_specified" (the Goal itself never named
// a commercial target -- true for every currently-live Goal, since no
// producer sets commercial_target_stage yet) is a genuinely different
// fact from "office_unavailable" (a real target exists, but Office
// couldn't be reached to check it) -- conflating them would hide a real
// operational problem behind an ordinary "not applicable" case.
export type CommercialOutcomeProvenance = "commercial_opportunity_evaluation" | "no_target_specified" | "office_unavailable";

export type CommercialOutcomeEvaluation = {
  result: CommercialOutcomeResult;
  provenance: CommercialOutcomeProvenance;
  targetStage: string | null;
  observedStage: string | null;
  observedStatus: string | null;
  // Office's own authoritative updated_at (or the latest stage-change
  // activity's own occurred_at, whichever is later) -- never Backend's
  // own read time (Section 25).
  evaluatedAt: string | null;
  // Every stage this Opportunity is known to have passed through,
  // including its current one -- the evidence behind an "achieved"
  // verdict for an intermediate target even if the Opportunity has since
  // moved further or terminated (Section 20).
  stagesEverReached: string[];
  causalNote: string;
  notes: string;
};

const CAUSAL_NOTE =
  "This evaluation establishes only whether Office's own authoritative Opportunity record currently satisfies (or has ever satisfied) the target commercial stage. " +
  "It does not by itself establish that any specific Decision, Goal, or communication caused this commercial progression -- see Section 26's causal ceiling.";

function emptyEvaluation(targetStage: string | null, provenance: CommercialOutcomeProvenance, notes: string): CommercialOutcomeEvaluation {
  return {
    result: "unverified",
    provenance,
    targetStage,
    observedStage: null,
    observedStatus: null,
    evaluatedAt: null,
    stagesEverReached: [],
    causalNote: CAUSAL_NOTE,
    notes,
  };
}

// Section 10/27 -- the exact reduction rule, derived from Office's own
// real, mirrored stage order (commercialStageOrder.ts), never an
// independent Backend-invented ordering:
//   - target === "won": achieved iff currently won; not_achieved iff
//     currently lost; else unverified (a "won" target can never be
//     historically satisfied by an intermediate stage -- Office's own
//     terminal-state protection means won, once reached, never regresses,
//     so "currently won" and "ever won" are the same fact).
//   - target === "lost": symmetric, defensive case (no real Goal targets
//     losing; included for completeness, never exercised by any real
//     producer).
//   - any intermediate target: achieved iff the Opportunity's own
//     stagesEverReached set contains the target OR any stage at or past
//     its ordinal position (excluding "lost", which is never forward
//     progress) -- this is what makes historical achievement survive a
//     LATER "lost" outcome (Section 20). If never reached AND currently
//     lost -> not_achieved (the target was genuinely never satisfied
//     before the pursuit ended). If never reached and still open ->
//     unverified (still could happen).
export function evaluateCommercialOpportunityOutcome(targetStage: string | null, snapshot: OfficeOpportunitySnapshot | null): CommercialOutcomeEvaluation {
  if (!targetStage) {
    return emptyEvaluation(null, "no_target_specified", "This Goal's target_entities.commercial_target_stage is unset -- no commercial target was ever specified, so there is nothing to evaluate.");
  }
  if (!snapshot) {
    return emptyEvaluation(targetStage, "office_unavailable", "Office's Opportunity authority could not be reached, or no Opportunity matching this Goal's opportunity_id was found -- outcome is honestly unverified, never fabricated as failure.");
  }

  const stagesEverReached = Array.from(new Set([snapshot.stage, ...snapshot.stageHistory.map((item) => item.targetStage).filter((value): value is string => Boolean(value))]));
  const latestActivityAt = snapshot.stageHistory.length ? snapshot.stageHistory[snapshot.stageHistory.length - 1].occurredAt : null;
  const evaluatedAt = latestActivityAt && new Date(latestActivityAt).getTime() > new Date(snapshot.updatedAt).getTime() ? latestActivityAt : snapshot.updatedAt;

  const base: Omit<CommercialOutcomeEvaluation, "result" | "notes"> = {
    provenance: "commercial_opportunity_evaluation",
    targetStage,
    observedStage: snapshot.stage,
    observedStatus: snapshot.status,
    evaluatedAt,
    stagesEverReached,
    causalNote: CAUSAL_NOTE,
  };

  if (targetStage === "won") {
    if (snapshot.stage === "won") return { ...base, result: "achieved", notes: `Office's Opportunity is currently "won", satisfying the target directly.` };
    if (snapshot.stage === "lost") return { ...base, result: "not_achieved", notes: `Office's Opportunity is currently "lost" -- the "won" target was not achieved.` };
    return { ...base, result: "unverified", notes: `Office's Opportunity is currently "${snapshot.stage}" -- not yet "won", and not lost either; still open.` };
  }
  if (targetStage === "lost") {
    if (snapshot.stage === "lost") return { ...base, result: "achieved", notes: `Office's Opportunity is currently "lost", satisfying the target directly.` };
    return { ...base, result: "unverified", notes: `Office's Opportunity is currently "${snapshot.stage}" -- the (unusual) "lost" target has not occurred.` };
  }

  const targetOrdinal = commercialStageOrdinal(targetStage);
  if (targetOrdinal === null) {
    return { ...base, result: "unverified", notes: `Target stage "${targetStage}" is not a recognized literal in Office's own commercial pipeline vocabulary -- cannot be evaluated safely.` };
  }
  const everReachedForward = stagesEverReached.some((stage) => {
    if (stage === "lost") return false;
    if (stage === "won") return true;
    const ordinal = commercialStageOrdinal(stage);
    return ordinal !== null && ordinal >= targetOrdinal;
  });
  if (everReachedForward) {
    return { ...base, result: "achieved", notes: `The Opportunity reached "${targetStage}" or a later stage at some point in its own recorded history, satisfying the target -- this remains true even if the Opportunity has since progressed further or terminated.` };
  }
  if (snapshot.stage === "lost") {
    return { ...base, result: "not_achieved", notes: `The Opportunity never reached "${targetStage}" (or later) before becoming "lost" -- the target was genuinely not achieved.` };
  }
  return { ...base, result: "unverified", notes: `The Opportunity has not yet reached "${targetStage}" (currently "${snapshot.stage}") and remains open -- still possible.` };
}
