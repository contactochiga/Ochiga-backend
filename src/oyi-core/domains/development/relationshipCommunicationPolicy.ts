// Oyi Communications Convergence, Slice 1 -- the relationship
// communication policy decision for a Development/JV enquiry. This is a
// thin, pure derivation on top of the EXISTING JvAssessment
// (developmentJv.ts) -- it does not re-reason about the opportunity, it
// only decides what, if anything, should happen communications-wise
// given what the JV capability already concluded. Scoped to
// Development/JV only in this slice; other business units are not
// covered yet (documented, not silently assumed).
//
// The load-bearing distinction this module exists to enforce:
//   opportunity_not_aligned  !=  relationship_not_worth_maintaining
// A JV outside current target geography still gets a professional
// acknowledgement and, where policy allows, keeps the relationship --
// it is never treated as a reason to go silent OR to pretend the
// opportunity is under active consideration when it is not.
import type { CommunicationContactability, CorporateCommunicationContext } from "../../../contracts/corporateIntelligence";
import type { JvAssessment } from "./developmentJv";

export type RelationshipCommunicationPolicy =
  | "IGNORE_AUTOMATION"
  | "ACKNOWLEDGE_ONLY"
  | "CONTINUE_RELATIONSHIP"
  | "REQUEST_MORE_INFORMATION"
  | "HANDOFF"
  | "DO_NOT_CONTACT";

export type SupportedGoalChannel = "whatsapp";

// WhatsApp only in this slice (per the audit: the one channel with a
// real, closed-loop inbound+outbound+correlation+takeover path already
// live). Returns null, honestly, when no whatsapp-reachable number is on
// file -- never falls back to a channel this slice hasn't proven end to
// end.
export function preferredSupportedChannel(context: CorporateCommunicationContext | null | undefined): SupportedGoalChannel | null {
  const number = context?.whatsapp_phone || context?.phone || null;
  return number ? "whatsapp" : null;
}

// contactability "unknown" is treated exactly like "denied" for any
// autonomous outbound decision -- the conservative default this slice's
// audit explicitly required (consent_present must never silently become
// allowed). Only an explicit "denied" state is distinguished for the
// caller's own logging/telemetry; both block automation identically.
export function relationshipCommunicationPolicyForJv(
  assessment: JvAssessment,
  communicationContext: CorporateCommunicationContext | null | undefined
): RelationshipCommunicationPolicy {
  const contactability: CommunicationContactability = communicationContext?.contactability || "unknown";
  if (contactability !== "allowed") return "DO_NOT_CONTACT";

  const channel = preferredSupportedChannel(communicationContext);
  if (!channel) return "IGNORE_AUTOMATION";

  if (assessment.recommended_next_step === "route_for_human_review") return "HANDOFF";
  if (assessment.recommended_next_step === "request_more_information") return "REQUEST_MORE_INFORMATION";
  if (assessment.recommended_next_step === "progress_opportunity") return "CONTINUE_RELATIONSHIP";

  // mark_outside_current_strategy: an opportunity that doesn't fit is
  // NOT the same as a relationship not worth maintaining. Only when
  // there isn't even enough evidence to safely compose a location-aware
  // acknowledgement (unknown_missing_location) does this slice hold
  // back rather than send something generic/potentially wrong.
  if (assessment.strategic_alignment.status === "unknown_missing_location") return "IGNORE_AUTOMATION";
  return "ACKNOWLEDGE_ONLY";
}

// Composes the proactive WhatsApp acknowledgement text for
// ACKNOWLEDGE_ONLY / CONTINUE_RELATIONSHIP / REQUEST_MORE_INFORMATION.
// Deliberately distinct from corporateOfficeInternalPolicy.ts's
// composeJvAnswer() (a REPLY to a question already asked) -- this is a
// proactive first message, a different shape, built from the SAME
// underlying JvAssessment fields (known_facts/strategic_alignment/
// missing_information), never re-reasoning about the opportunity. Never
// claims the opportunity is "under consideration" when the assessment
// says otherwise; never fabricates investment interest.
export function composeRelationshipAcknowledgement(assessment: JvAssessment, policy: RelationshipCommunicationPolicy): string | null {
  const location = typeof assessment.known_facts.location === "string" ? assessment.known_facts.location : null;
  const opportunityType = typeof assessment.known_facts.opportunity_type === "string" ? assessment.known_facts.opportunity_type : "opportunity";

  if (policy === "CONTINUE_RELATIONSHIP") {
    return `Thank you for sharing details of your ${opportunityType}${location ? ` in ${location}` : ""}. This aligns with an area we're currently focused on -- a member of our development team will follow up with you directly.`;
  }
  if (policy === "REQUEST_MORE_INFORMATION") {
    const missing = assessment.missing_information.filter((field) => field === "opportunity_type" || field === "location" || field === "land_size");
    const ask = missing.length ? missing.map((field) => field.replace(/_/g, " ")).join(", ") : "a few more details";
    return `Thank you for reaching out about your development opportunity. To review this properly, could you share ${ask}?`;
  }
  if (policy === "ACKNOWLEDGE_ONLY") {
    return `Thank you for sharing details of your ${opportunityType}${location ? ` in ${location}` : ""}. This is currently outside the areas we're focused on for development/JV opportunities, so we won't be progressing it right now -- we'll keep your details on file and will be in touch if that changes.`;
  }
  return null;
}
