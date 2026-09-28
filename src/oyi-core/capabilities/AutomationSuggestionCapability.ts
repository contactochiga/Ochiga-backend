import { nluToAutomation, type NLUContext } from "../../utils/ai";
import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import type { DomainResult } from "../contracts/domainResult";
import type { OyiEvidence } from "../contracts/evidence";
import { resultPresentation } from "./ReadCapabilityModules";

export const AUTOMATION_SUGGESTION_CAPABILITY = "automations.suggest";

function suggestionContext(context: CapabilityContext): NLUContext | null {
  const raw = (context.input.context as Record<string, unknown> | null | undefined)?.automation_suggestion_context;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Partial<NLUContext>;
  return {
    devices: Array.isArray(value.devices) ? value.devices.slice(0, 500) : [],
    homes: Array.isArray(value.homes) ? value.homes.slice(0, 100) : [],
    estates: Array.isArray(value.estates) ? value.estates.slice(0, 20) : [],
  };
}

/**
 * The model is a bounded structure parser beneath Core. It receives only
 * server-loaded, actor-scoped device context and returns a draft; it cannot
 * grant permissions, persist an automation, or execute one.
 */
export function buildAutomationSuggestionCapability(): CapabilityModule {
  return {
    key: AUTOMATION_SUGGESTION_CAPABILITY,
    domain: "automations",
    rolloutStatus: "enabled",
    operations: ["automation.suggest"],
    supported_surfaces: ["consumer", "facility"],
    scope_requirements: [{ scope: "estate", required: true }],
    permission_requirements: ["devices.control"],
    risk_class: "low_risk_action",
    confirmation_policy: "review",
    evidence_requirements: [],
    presentation_policy: { primary: "review", expose_evidence: "hidden", allow_internal_ids: false },
    supports: (frame) => frame.domain === "automations" && String(frame.operation) === "automation.suggest",
    async resolve(context) {
      return suggestionContext(context) ? { supported: true, reason: null } : { supported: false, reason: "missing_server_loaded_automation_context" };
    },
    async collectEvidence(): Promise<OyiEvidence[]> { return []; },
    async buildReadResponse(context): Promise<DomainResult> {
      const boundedContext = suggestionContext(context);
      if (!boundedContext) {
        return { status: "unavailable", answer: "I cannot safely prepare an automation without authorised device context.", presentation_policy: resultPresentation("text") };
      }
      try {
        const proposal = await nluToAutomation(context.input.message, boundedContext);
        const needsClarification = Boolean((proposal as any)?.trigger?.needs_clarification || (proposal as any)?.action?.needs_clarification);
        return {
          status: "draft",
          answer: needsClarification
            ? String((proposal as any)?.trigger?.clarification_question || (proposal as any)?.action?.clarification_question || "What detail should I use for this automation?")
            : "I prepared an automation proposal for your review. It has not been saved or activated.",
          presentation_policy: resultPresentation("text"),
          metadata: { proposal, requires_review: true, persistence_authority: "manual_or_governed_workflow", provider_role: "bounded_domain_parser" },
        };
      } catch {
        return { status: "unavailable", answer: "Oyi could not safely prepare an automation proposal. Nothing was saved or executed.", presentation_policy: resultPresentation("text") };
      }
    },
  };
}
