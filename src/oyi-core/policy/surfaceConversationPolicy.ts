import type {
  CanonicalConversationRequest,
  OperationalObject,
} from "../contracts/canonicalConversation";
import { currentTurnExplicitlyGlobal } from "../interpretation/conversationIntentRouting";

export function globalCapabilityAnswerForSurface(surface: CanonicalConversationRequest["surface"]) {
  if (surface === "public_corporate") {
    return "I can answer public Ochiga questions, explain Oyi, route Development, Technology, Private and Partnership enquiries, and prepare safe handoffs to the Office team.";
  }
  if (surface === "office_internal") {
    return "I can help Ochiga staff with CRM, projects, portfolio, support, documents, Private, partnerships, tasks, follow-ups, and corporate intelligence. Operational building actions still require the proper Facility or Consumer authorization path.";
  }
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
