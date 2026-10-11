import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import type { CanonicalConversationRequest, CanonicalConversationResponse } from "../contracts/canonicalConversation";

export type CanonicalConversationRequestContext = {
  // Server-derived per invocation from the owned canonical conversation history.
  // Never accepted from input.context; not another persistence/memory system.
  safetyContext?: { hazard: import("../response/answerTarget").HazardClass | null; historyAvailable: boolean };
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  input: CanonicalConversationRequest;
};

export type ConversationRunResult = CanonicalConversationResponse;
