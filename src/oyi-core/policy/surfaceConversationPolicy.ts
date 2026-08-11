import type {
  CanonicalConversationRequest,
  OperationalObject,
} from "../contracts/canonicalConversation";
import { currentTurnExplicitlyGlobal } from "../interpretation/conversationIntentRouting";

export function globalCapabilityAnswerForSurface(surface: CanonicalConversationRequest["surface"]) {
  return surface === "facility"
    ? "I can answer authorised building operations questions, generate reports, investigate incidents, and prepare safe actions when policy allows."
    : "I can help you understand and control authorised devices, review rooms and recent activity, manage visitors and maintenance, check wallet and utility information, and prepare scenes or automations safely.";
}

export function buildSurfaceCapabilityAnswer(input: {
  object: OperationalObject | null;
  request: CanonicalConversationRequest;
  objectCapabilityLine: (object: OperationalObject) => string;
}) {
  if (!input.object || input.object.object_type === "home" || currentTurnExplicitlyGlobal(input.request.message)) {
    return globalCapabilityAnswerForSurface(input.request.surface);
  }
  return input.objectCapabilityLine(input.object);
}
