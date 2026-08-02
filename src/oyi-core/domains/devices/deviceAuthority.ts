import type { AuthorityDecision } from "../../contracts/authority";
import type { CapabilityContext } from "../../contracts/capability";

export function authorizeDeviceConversation(context: CapabilityContext): AuthorityDecision {
  const mutation = context.resolvedTurn.semantic_frame.mutationIntent;
  return {
    allowed: true,
    tier: mutation ? 1 : 0,
    approval_required: mutation,
    secure_review_required: false,
    required_permissions: [],
    denial_reason: null,
  };
}
