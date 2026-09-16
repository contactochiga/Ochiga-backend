// Office Intelligence Convergence, Wave 3 -- the first real Development/
// JV Core capability. Office remains the source of truth for the CRM
// record and the only party that executes any Office mutation; this
// module only INTERPRETS whatever evidence Office has already supplied
// (see OfficeInternalOyiCoreRequest.development_context and
// CorporateMaterialEvent's development-enquiry metadata) and returns a
// structured, advisory assessment. It never fabricates land values,
// title validity, feasibility, financial returns or credibility, and it
// never calls out to Office's database -- Backend has no direct
// connection to it.
//
// Strategy/preferences are explicit, injectable DATA (JvStrategy below),
// not branches hidden in this reasoning code -- callers may supply a
// different strategy (e.g. from a future Office-managed settings
// surface) and get a different, still-transparent answer. The default
// instance reflects Ochiga's current stated focus, not an immutable rule.

export type JvTargetArea = { region: "Lagos" | "Abuja"; area: string };

export type JvStrategy = {
  // Areas Ochiga is currently focused on for development/JV opportunities.
  // Matching is substring-based against the supplied location text, so
  // "Ikoyi, Lagos" or "Lekki Phase 1" both resolve against "Ikoyi"/"Lekki".
  targetAreas: JvTargetArea[];
  // A target JV equity split, expressed as [ochigaShare, landownerShare]
  // out of 100 -- "around 70/30, subject to negotiation" per current
  // guidance. Used only to flag a wide divergence as a consideration for
  // human review, never to auto-reject a structure.
  preferredStructure: { ochigaShare: number; landownerShare: number; toleranceBand: number };
  // Transaction-progression documents Ochiga typically expects to see
  // move a JV forward (Letter of Intent / Proof of Funds / Bank
  // Guarantee). Referenced only in the assessment's considerations, not
  // used to gate the recommendation in V1.
  progressionMarkers: string[];
};

export const DEFAULT_JV_STRATEGY: JvStrategy = {
  targetAreas: [
    { region: "Lagos", area: "Ikoyi" },
    { region: "Lagos", area: "Victoria Island" },
    { region: "Lagos", area: "Lekki" },
    { region: "Lagos", area: "Ikeja" },
    { region: "Abuja", area: "Asokoro" },
    { region: "Abuja", area: "Katampe Extension" },
    { region: "Abuja", area: "Guzape" },
  ],
  preferredStructure: { ochigaShare: 70, landownerShare: 30, toleranceBand: 15 },
  progressionMarkers: ["Letter of Intent (LOI)", "Proof of Funds (POF)", "Bank Guarantee (BG)"],
};

export type JvEvidence = {
  opportunityType?: string | null;
  location?: string | null;
  landSize?: string | null;
  structureOffered?: string | null;
  landownerExpectation?: string | null;
  titleDocumentStatus?: string | null;
  commercialTerms?: string | null;
  timeline?: string | null;
  scaleUnits?: number | null;
  sourceChannel?: string | null;
  decisionMakerStatus?: string | null;
};

export type JvRecommendedNextStep =
  | "request_more_information"
  | "route_for_human_review"
  | "progress_opportunity"
  | "mark_outside_current_strategy";

export type JvStrategicAlignment =
  | { status: "aligned"; matchedArea: JvTargetArea }
  | { status: "outside_current_focus"; suppliedLocation: string }
  | { status: "unknown_missing_location" };

export type JvAssessment = {
  known_facts: Record<string, string | number>;
  missing_information: string[];
  inferred_considerations: string[];
  strategic_alignment: JvStrategicAlignment;
  recommended_next_step: JvRecommendedNextStep;
  proposed_office_action: string;
  // Named so a caller can tell which strategy produced this assessment --
  // strategy is evidence/config, not code, so this is provenance, not a
  // fact about the opportunity itself.
  strategy_reference: { preferred_split: string; target_area_count: number };
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function findMatchedArea(location: string, strategy: JvStrategy): JvTargetArea | null {
  const haystack = normalizeText(location);
  return strategy.targetAreas.find((target) => haystack.includes(normalizeText(target.area))) || null;
}

// Extracts an "X/Y" or "X:Y" split from free text (e.g. "60/40", "55:45")
// without ever inventing one. Returns null if no such pattern is present
// -- the assessment then honestly reports structure as missing/unparsed
// rather than guessing.
function parseOfferedSplit(structureOffered: string | null | undefined): { ochigaShare: number; landownerShare: number } | null {
  const text = String(structureOffered || "");
  const match = text.match(/(\d{1,3})\s*[:\/]\s*(\d{1,3})/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a + b <= 0) return null;
  return { ochigaShare: a, landownerShare: b };
}

export function assessJvOpportunity(evidence: JvEvidence, strategy: JvStrategy = DEFAULT_JV_STRATEGY): JvAssessment {
  const known: Record<string, string | number> = {};
  const missing: string[] = [];
  const considerations: string[] = [];

  if (evidence.opportunityType) known.opportunity_type = evidence.opportunityType;
  else missing.push("opportunity_type");

  if (evidence.location) known.location = evidence.location;
  else missing.push("location");

  if (evidence.landSize) known.land_size = evidence.landSize;
  else missing.push("land_size");

  if (evidence.structureOffered) known.structure_offered = evidence.structureOffered;
  else missing.push("jv_structure_offered");

  if (evidence.landownerExpectation) known.landowner_expectation = evidence.landownerExpectation;
  else missing.push("landowner_expectation");

  if (evidence.titleDocumentStatus) known.title_document_status = evidence.titleDocumentStatus;
  else missing.push("title_document_status");

  if (evidence.commercialTerms) known.commercial_terms = evidence.commercialTerms;
  else missing.push("commercial_terms");

  if (evidence.timeline) known.timeline = evidence.timeline;
  if (typeof evidence.scaleUnits === "number" && Number.isFinite(evidence.scaleUnits)) known.scale_units = evidence.scaleUnits;
  if (evidence.sourceChannel) known.source_channel = evidence.sourceChannel;
  if (evidence.decisionMakerStatus) known.decision_maker_status = evidence.decisionMakerStatus;

  const alignment: JvStrategicAlignment = evidence.location
    ? (() => {
        const matched = findMatchedArea(evidence.location as string, strategy);
        return matched ? { status: "aligned" as const, matchedArea: matched } : { status: "outside_current_focus" as const, suppliedLocation: evidence.location as string };
      })()
    : { status: "unknown_missing_location" as const };

  const offeredSplit = parseOfferedSplit(evidence.structureOffered);
  if (offeredSplit) {
    const divergence = Math.abs(offeredSplit.ochigaShare - strategy.preferredStructure.ochigaShare);
    if (divergence > strategy.preferredStructure.toleranceBand) {
      considerations.push(
        `Proposed structure (${offeredSplit.ochigaShare}/${offeredSplit.landownerShare}) diverges from the current target range (around ${strategy.preferredStructure.ochigaShare}/${strategy.preferredStructure.landownerShare}); subject to negotiation, not a disqualifier.`
      );
    }
  } else if (evidence.structureOffered) {
    considerations.push("A JV structure was mentioned but no clear equity split could be identified from it -- worth confirming directly.");
  }

  if (alignment.status === "aligned") {
    considerations.push(`Supplied location matches a current focus area (${alignment.matchedArea.area}, ${alignment.matchedArea.region}).`);
  }
  if (missing.includes("title_document_status")) {
    considerations.push("No title/document status supplied yet -- this is typically established once the opportunity progresses (e.g. via " + strategy.progressionMarkers.join(", ") + ").");
  }

  let recommendedNextStep: JvRecommendedNextStep;
  let proposedOfficeAction: string;

  const criticalMissingCount = ["opportunity_type", "location", "land_size"].filter((field) => missing.includes(field)).length;

  if (criticalMissingCount >= 2 || alignment.status === "unknown_missing_location") {
    recommendedNextStep = "request_more_information";
    proposedOfficeAction = "Ask the contact for opportunity type, location, and land size before further review.";
  } else if (alignment.status === "outside_current_focus") {
    recommendedNextStep = "mark_outside_current_strategy";
    proposedOfficeAction = `Location (${(alignment as any).suppliedLocation}) is outside Ochiga's current focus areas. Record as outside current strategy; may still warrant a human look if other factors are compelling.`;
  } else if (criticalMissingCount === 0 && evidence.commercialTerms) {
    recommendedNextStep = "progress_opportunity";
    proposedOfficeAction = "Sufficient aligned evidence is present -- recommend progressing this opportunity in CRM for staff-led commercial review.";
  } else {
    recommendedNextStep = "route_for_human_review";
    proposedOfficeAction = "Aligned but with real gaps in the evidence -- route to a staff member for direct qualification.";
  }

  return {
    known_facts: known,
    missing_information: missing,
    inferred_considerations: considerations,
    strategic_alignment: alignment,
    recommended_next_step: recommendedNextStep,
    proposed_office_action: proposedOfficeAction,
    strategy_reference: {
      preferred_split: `${strategy.preferredStructure.ochigaShare}/${strategy.preferredStructure.landownerShare}`,
      target_area_count: strategy.targetAreas.length,
    },
  };
}
