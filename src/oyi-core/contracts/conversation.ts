import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import type { CanonicalConversationRequest, CanonicalConversationResponse } from "../runtime/canonicalConversationRuntime";

export type CanonicalConversationRequestContext = {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  input: CanonicalConversationRequest;
};

export type ConversationRunResult = CanonicalConversationResponse;
