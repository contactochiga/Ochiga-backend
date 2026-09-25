// Wave 8 Slice 4 -- Commercial Outcome Evaluator.
//
// An explicitly-versioned MIRROR of Office's own real, live canonical
// commercial pipeline order (ochiga-office's commercial-ops.js ->
// PIPELINE_STAGES, the exact array Office's own commercial-approval/
// proposal routes already use to validate/derive lead.stage sequencing --
// re-confirmed against Office HEAD c08cb92). This is NOT Backend's own
// invented ordering: Backend and Office are separate repositories with
// no shared package, so per the task's own explicit instruction ("prefer
// an explicitly versioned mirror if cross-repo boundaries require it"),
// this constant is copied verbatim, not re-derived or approximated.
//
// DRIFT RISK: if Office's own PIPELINE_STAGES ever changes (a stage
// renamed, reordered, or added), this mirror goes stale silently -- there
// is no automated cross-repo check today. Mitigation: MIRROR_SOURCE below
// pins the exact Office file/version this was copied from, so a future
// audit can re-diff it by hand. This is a real, disclosed limitation
// (see docs/WAVE8_SLICE4_COMMERCIAL_OUTCOME_EVALUATOR.md), not silently
// assumed correct forever.
export const MIRROR_SOURCE = {
  repo: "ochiga-office",
  file: "src/lead-agents/commercial-ops.js",
  symbol: "PIPELINE_STAGES",
  mirroredAtOfficeHead: "c08cb92",
} as const;

// Office's own real, ordered pipeline literal set (commercial-ops.js:3-14).
// "intake_received" is crm_opportunities.stage's own real DB default
// (not itself a PIPELINE_STAGES member -- Office's own Opportunity
// authority, office-operational-workflows.js's OPPORTUNITY_STAGE_TRANSITIONS,
// treats it as the sole entry point ahead of this pipeline) and is
// prepended here at ordinal 0 so a freshly-created, never-transitioned
// Opportunity has an honest, lower-than-everything ordinal position.
export const COMMERCIAL_STAGE_ORDER: readonly string[] = [
  "intake_received",
  "new",
  "contacted",
  "qualified",
  "discovery_scheduled",
  "site_visit_scheduled",
  "proposal_sent",
  "negotiation",
  "commercial_approved",
  "won",
  "lost",
];

export function commercialStageOrdinal(stage: string): number | null {
  const index = COMMERCIAL_STAGE_ORDER.indexOf(stage);
  return index >= 0 ? index : null;
}

export function isKnownCommercialStage(stage: string): boolean {
  return COMMERCIAL_STAGE_ORDER.includes(stage);
}
