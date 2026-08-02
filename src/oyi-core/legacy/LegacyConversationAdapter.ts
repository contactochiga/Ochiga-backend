import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import type { CanonicalConversationRequest, CanonicalConversationResponse } from "../runtime/canonicalConversationRuntime";
import { runCanonicalConversation } from "../runtime/canonicalConversationRuntime";
import { incrementLegacyFallback } from "../observability/ConversationMetrics";
import { logger } from "../../observability/logger";

export class LegacyConversationAdapter {
  async run(actor: AuthUser | null, oisContext: OisContext | null | undefined, input: CanonicalConversationRequest, reason = "unimplemented_capability"): Promise<CanonicalConversationResponse> {
    incrementLegacyFallback(reason, null, null);
    logger.info("oyi_conversation_legacy_adapter_invoked", {
      reason,
      thread_id: input.thread_id || null,
      surface: input.surface,
      module: input.module || null,
    });
    return runCanonicalConversation(actor, oisContext, input);
  }
}

export const legacyConversationAdapter = new LegacyConversationAdapter();
