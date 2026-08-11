import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";
import {
  namedDevicePhraseFromControlMessage,
  requestedChannelCode,
} from "../runtime/conversationTargetResolver";
import {
  currentTurnAllowsDeviceResolution as intentCurrentTurnAllowsDeviceResolution,
  currentTurnExplicitlyGlobal,
  currentTurnHasExplicitDomain,
  domainForCurrentTurn,
  interpretSemanticOperation as interpretSemanticOperationForRouting,
  isExplicitBroadHomeReadIntent,
  isReadOnlyBroadDeviceIntent,
  operationForCurrentTurn as intentOperationForCurrentTurn,
  semanticOperationAction as semanticOperationActionForRouting,
  type ScopeMode,
} from "../interpretation/conversationIntentRouting";
import { temporalScopeFor } from "./conversationContextLayers";
import type {
  CanonicalConversationRequest,
  CurrentTurnAuthorityDecision,
} from "../contracts/canonicalConversation";
import type { ConversationObjectCandidate } from "./conversationObjectHydration";

function text(value: unknown) {
  return String(value ?? "").trim();
}

export const INHERITABLE_EXACT_TARGET_TYPES = new Set([
  "device",
  "device_channel",
  "maintenance_request",
  "visitor",
  "access_pass",
  "operational_incident",
  "access_point",
  "service_account",
  "meter",
  "message_thread",
  "community_post",
  "scene",
  "automation",
]);

export function requestedPowerState(message: string) {
  const lower = message.toLowerCase();
  if (/\b(turn|switch|put|power)\b.*\b(on|up)\b|\bput it on\b|\bon this\b/i.test(lower)) return "on";
  if (/\b(turn|switch|put|power)\b.*\b(off|down)\b|\boff this\b|\bturn everything off\b/i.test(lower)) return "off";
  return "";
}

export function isControlRequest(message: string) {
  return /\b(turn|switch|put|power|lock|unlock|open|close|dim|set|run|approve|extend|escalate|assign|pay|buy|fund)\b/i.test(message);
}

export function isExplanationRequest(message: string) {
  return /\b(why|explain|reason|what caused|because)\b/i.test(message);
}

export function currentTurnReferencesInheritedTarget(message: string) {
  return /\b(it|this|that|same one|same device|same channel|same meter|same request|this device|this channel|this meter|this request|this incident|this service|selected device|selected channel|selected meter|current device|current channel|current meter|its|he|she|they|him|her|that visitor|this visitor|that pass|this pass)\b/i.test(text(message));
}

export function interpretSemanticOperation(message: string, roomPhraseFromMessage: (message: string) => string) {
  return interpretSemanticOperationForRouting(message, { roomPhraseFromMessage });
}

export function semanticOperationAction(message: string, surface: OyiSurface, roomPhraseFromMessage: (message: string) => string) {
  return semanticOperationActionForRouting(message, surface, { roomPhraseFromMessage });
}

export function operationForCurrentTurn(message: string) {
  return intentOperationForCurrentTurn(message, isControlRequest);
}

export function currentTurnAllowsDeviceResolution(message: string, roomPhraseFromMessage: (message: string) => string) {
  return intentCurrentTurnAllowsDeviceResolution(message, {
    roomPhraseFromMessage,
    isControlRequest,
    currentTurnReferencesInheritedTarget,
  });
}

function inheritedDomainFor(type: string | null | undefined) {
  if (type === "visitor" || type === "access_pass") return "visitors";
  if (type === "maintenance_request") return "maintenance";
  if (type === "operational_incident" || type === "access_point") return "security";
  if (type === "service_account" || type === "meter") return "services";
  if (type === "message_thread") return "messages";
  if (type === "community_post") return "community";
  if (type === "scene") return "scenes";
  if (type === "automation") return "automations";
  if (type === "device" || type === "device_channel") return "devices";
  return null;
}

export function resolveCurrentTurnAuthorityDecision(
  input: CanonicalConversationRequest,
  inherited: ConversationObjectCandidate | null,
  options: {
    roomPhrase: string;
    broadReadOnlyDeviceIntent: boolean;
    semanticOperation: ReturnType<typeof interpretSemanticOperation> | null;
  },
): CurrentTurnAuthorityDecision {
  const message = text(input.message);
  const domain = domainForCurrentTurn(message);
  const operation = options.semanticOperation?.operationClass || operationForCurrentTurn(message);
  const explicitRoomPhrase = options.roomPhrase || null;
  const explicitObjectPhrase = namedDevicePhraseFromControlMessage(message, { isControlRequest });
  let scope: ScopeMode = "global_scope";
  if (options.broadReadOnlyDeviceIntent || domain === "utilities" || domain === "wallet" || currentTurnExplicitlyGlobal(message)) scope = "home_scope";
  if (explicitRoomPhrase) scope = "room_scope";
  if (options.semanticOperation?.scopeMode) scope = options.semanticOperation.scopeMode;
  const inheritedType = inherited?.object_type || null;
  const inheritedDomain = inheritedDomainFor(inheritedType);
  const referentialTurn = currentTurnReferencesInheritedTarget(message);
  const explicitChannelReplacement = Boolean(requestedChannelCode(message) && isControlRequest(message) && inherited && ["device", "device_channel"].includes(inherited.object_type));
  const domainBlocksInherited = Boolean(domain && domain !== "devices" && !(referentialTurn && (domain === inheritedDomain || domain === "reports")));
  const semanticBlocksInherited = Boolean(options.semanticOperation && !(domain === "reports" && referentialTurn));
  const hasBlockingCurrentTurnSemantics = Boolean(options.broadReadOnlyDeviceIntent || explicitRoomPhrase || semanticBlocksInherited || currentTurnExplicitlyGlobal(message) || domainBlocksInherited);
  const mayUseInheritedExactTarget = Boolean(
    inherited
      && INHERITABLE_EXACT_TARGET_TYPES.has(inherited.object_type)
      && !hasBlockingCurrentTurnSemantics
      && (referentialTurn || explicitChannelReplacement),
  );
  return {
    operation,
    domain,
    scope,
    explicitRoomPhrase,
    explicitObjectPhrase,
    temporalScope: temporalScopeFor(message).mode,
    mayUseInheritedExactTarget,
    rejectionReason: inheritedType && !mayUseInheritedExactTarget
      ? hasBlockingCurrentTurnSemantics
        ? domain && domain !== "devices" ? `explicit_${domain}_domain` : explicitRoomPhrase ? "explicit_room_scope" : options.semanticOperation ? "explicit_domain_or_navigation" : "global_or_home_turn"
        : "not_referential"
      : null,
  };
}

export function canInheritedExactTargetSatisfyCurrentTurn(
  input: CanonicalConversationRequest,
  inherited: ConversationObjectCandidate | null,
  options: {
    roomPhrase: string;
    broadReadOnlyDeviceIntent: boolean;
    semanticOperation: ReturnType<typeof interpretSemanticOperation> | null;
  },
) {
  if (!inherited || !INHERITABLE_EXACT_TARGET_TYPES.has(inherited.object_type)) return false;
  const authority = resolveCurrentTurnAuthorityDecision(input, inherited, options);
  if (!authority.mayUseInheritedExactTarget) return false;
  const message = text(input.message);
  const contextRecord = input.context && typeof input.context === "object" ? input.context as Record<string, unknown> : {};
  const conversationRecord = input.conversation_context || {};
  const scopeHint = text(input.scope_mode_hint || conversationRecord.scope_mode_hint || contextRecord.scope_mode_hint).toLowerCase();
  const intentHint = text(input.intent_hint || conversationRecord.intent_hint || contextRecord.intent_hint).toLowerCase();
  if (options.broadReadOnlyDeviceIntent || options.roomPhrase || currentTurnExplicitlyGlobal(message) || options.semanticOperation) return false;
  if (currentTurnReferencesInheritedTarget(message)) return true;
  if (currentTurnHasExplicitDomain(message)) return false;
  if (scopeHint === "exact_target" && ["activity_history", "failure_history", "diagnosis", "relationships", "evidence", "current_state", "health_check", "command_outcome", "capability"].includes(intentHint)) return true;
  return false;
}

export function inheritedTargetEligibilityForTest(input: { message: string; object?: Record<string, unknown> | null; request?: Partial<CanonicalConversationRequest> }, roomPhraseFromMessage: (message: string) => string) {
  const request = {
    message: input.message,
    surface: "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest;
  return canInheritedExactTargetSatisfyCurrentTurn(request, input.object as ConversationObjectCandidate | null, {
    roomPhrase: roomPhraseFromMessage(input.message),
    broadReadOnlyDeviceIntent: isReadOnlyBroadDeviceIntent(input.message),
    semanticOperation: interpretSemanticOperation(input.message, roomPhraseFromMessage),
  });
}

export function currentTurnAuthorityForTest(input: { message: string; object?: Record<string, unknown> | null; request?: Partial<CanonicalConversationRequest> }, roomPhraseFromMessage: (message: string) => string) {
  const request = {
    message: input.message,
    surface: "consumer",
    ...(input.request || {}),
  } as CanonicalConversationRequest;
  const roomPhrase = roomPhraseFromMessage(input.message);
  return resolveCurrentTurnAuthorityDecision(request, input.object as ConversationObjectCandidate | null, {
    roomPhrase,
    broadReadOnlyDeviceIntent: isExplicitBroadHomeReadIntent(input.message, text(input.request?.scope_mode_hint)),
    semanticOperation: interpretSemanticOperation(input.message, roomPhraseFromMessage),
  });
}
