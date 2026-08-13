import type { CapabilityService } from "./CapabilityService";
import type { CanonicalConversationRequestContext } from "../contracts/conversation";
import type { DomainResult } from "../contracts/domainResult";

const DOMAIN_LABELS: Record<string, string> = {
  devices: "device status and availability",
  wallet: "wallet transaction history",
  utilities: "utility spending",
  global: "Oyi capability help",
};

export function buildCapabilityAdvertisingResult(input: {
  service: CapabilityService;
  context: CanonicalConversationRequestContext;
}): DomainResult {
  const capabilities = input.service.listForActor({
    actor: input.context.actor,
    oisContext: input.context.oisContext,
    surface: input.context.input.surface,
  });
  const domains = Array.from(new Set(capabilities.map((capability) => capability.domain).filter((domain) => domain !== "global")));
  if (!domains.length) {
    return {
      status: "empty",
      answer: "I do not have any enabled read capabilities for this surface and scope yet.",
      presentation_policy: { primary: "list", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
      metadata: { capabilities },
    };
  }
  const lines = domains.map((domain) => `• ${DOMAIN_LABELS[domain] || domain}`);
  return {
    status: "answered",
    answer: [
      "Here is what I can safely do for you from the enabled capability registry right now:",
      ...lines,
      "I will not advertise or execute capabilities that are only declared, shadowed, or not authorised for this surface.",
    ].join("\n"),
    blocks: [{
      type: "capability_list",
      capabilities: capabilities.map((capability) => ({
        key: capability.key,
        domain: capability.domain,
        operations: capability.operations,
        rollout_status: capability.rollout_status,
        risk_class: capability.risk_class,
      })),
    }],
    presentation_policy: { primary: "list", allowed_supporting_blocks: ["text", "list"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
    metadata: { capabilities },
  };
}
