import { randomUUID } from "crypto";
import type { AuthUser } from "../../middleware/auth";
import { logger } from "../../observability/logger";
import type { OisContext } from "../../types/oisContext";
import { deviceRuntimeStateService } from "../../services/deviceRuntimeStateService";
import type { OyiSurface } from "../../services/oyiUnifiedIntelligenceService";
import { normalizeUserTurn, type NormalizedUserTurn, type OyiDomain } from "./languageUnderstanding";
import { capabilityKeyForTurn, decideAuthorityForTurn } from "./domainCapabilityRegistry";
import { createWorkflow, type CanonicalTarget, type OyiWorkflow } from "./conversationWorkflowRuntime";
import { hydrateCanonicalTarget } from "./canonicalTargetHydrationRegistry";
import {
  requestedChannelCode,
  roomPhraseFromMessage,
} from "./conversationTargetResolver";
import {
  currentTurnAllowsDeviceResolution as authorityCurrentTurnAllowsDeviceResolution,
  interpretSemanticOperation as authorityInterpretSemanticOperation,
  isControlRequest,
  requestedPowerState,
  semanticOperationAction as authoritySemanticOperationAction,
} from "../context/currentTurnAuthority";
import { temporalScopeFor } from "../context/conversationContextLayers";
import { safeDateLabel } from "../presentation/timeFreshness";
import { buildSurfaceCapabilityAnswer } from "../policy/surfaceConversationPolicy";
import { objectCapabilityLine, objectStateLine } from "../presentation/objectFallbackPresentation";
import { isBroadReportRequest } from "../domains/reports/reportEvidence";
import { factFromOperationalObject, isResidentVisibleOperationalFact } from "../domains/devices/deviceEvidence";
import { securityRiskAllowed } from "../domains/security/securityEvidence";
import {
  currentTurnExplicitlyGlobal,
  domainForCurrentTurn,
  isExplicitBroadHomeReadIntent,
  isReadOnlyBroadDeviceIntent,
  type CanonicalIntent,
  type IntelligenceRequestContract,
  type OperationClass,
  type ScopeMode,
} from "../interpretation/conversationIntentRouting";
import type {
  CanonicalConversationRequest,
  ConversationBuilderKey,
  ConversationOperation,
  ConversationPresentationPolicy,
  IntelligenceFact,
  OperationalObject,
  PendingClarification,
  ResolvedConversationTurn,
  ResolvedOyiTurn,
} from "../contracts/canonicalConversation";
import type { PresentationFactPredicates } from "../presentation/conversationAnswerPresentation";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown, fallback: string) {
  const next = text(value);
  return next || fallback;
}

function normalizeLookupText(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function interpretSemanticOperation(message: string) {
  return authorityInterpretSemanticOperation(message, roomPhraseFromMessage);
}

export function semanticOperationAction(message: string, surface: OyiSurface) {
  return authoritySemanticOperationAction(message, surface, roomPhraseFromMessage);
}

export function currentTurnAllowsDeviceResolution(message: string) {
  return authorityCurrentTurnAllowsDeviceResolution(message, roomPhraseFromMessage);
}



export function parseDeviceChannelIdentity(canonicalId: string | null | undefined) {
  const raw = text(canonicalId);
  const idx = raw.lastIndexOf(":");
  if (idx <= 0) return { parent_id: null, channel_code: null };
  return { parent_id: raw.slice(0, idx), channel_code: raw.slice(idx + 1) };
}

export function resolveIntentContract(input: CanonicalConversationRequest, object: OperationalObject | null, targetResolution: Record<string, unknown>): IntelligenceRequestContract {
  const message = text(input.message);
  const lower = message.toLowerCase();
  const hint = text(input.intent_hint || recordOf(input.conversation_context).intent_hint || recordOf(input.context).intent_hint).toLowerCase();
  const operationHint = text(input.operation_class_hint || recordOf(input.conversation_context).operation_class_hint || recordOf(input.context).operation_class_hint).toLowerCase();
  const scopeHint = text(input.scope_mode_hint || recordOf(input.conversation_context).scope_mode_hint || recordOf(input.context).scope_mode_hint).toLowerCase();
  const conversationRequestId = text(recordOf(input.context).request_id || recordOf(input.conversation_context).conversation_request_id) || randomUUID();
  const targetType = text(object?.object_type || targetResolution.objectType) || null;
  const targetId = text(object?.canonical_id || targetResolution.objectId) || null;
  const parsedChannel = targetType === "device_channel" ? parseDeviceChannelIdentity(targetId) : { parent_id: null, channel_code: null };
  const explicitBroad = isExplicitBroadHomeReadIntent(message, scopeHint) || /\b(whole home|all devices|everything|home summary|home report|show offline)\b/i.test(lower);
  const semanticCandidate = interpretSemanticOperation(message);
  const currentTurnDomain = domainForCurrentTurn(message);
  const reportBroadTarget = isBroadReportRequest(message, currentTurnDomain);
  const reportExactTarget = currentTurnDomain === "reports" && !reportBroadTarget && /\b(report|analytics?|trend|compare|comparison|performance)\b/i.test(lower);
  const maintenanceReadRequested = currentTurnDomain === "maintenance"
    && /\b(what|show|list|view|status|has|who|history|open|closed|resolved|overdue|issues?|requests?|tickets?)\b/i.test(lower)
    && !/\b(create|report|raise|log|assign|escalate|close|cancel|reopen|update)\b/i.test(lower);
  const maintenanceActionRequested = currentTurnDomain === "maintenance"
    && /\b(create|report|raise|log|assign|escalate|close|cancel|reopen|update)\b/i.test(lower);
  const visitorReadRequested = currentTurnDomain === "visitors"
    && /\b(who|what|when|has|is|can|show|list|view|status|history|expected|pending|arrived|arrival|came in|come in|valid|expired|currently)\b/i.test(lower)
    && !/\b(create|invite|add|approve|deny|reject|revoke|cancel|extend|give|grant|allow|remove)\b/i.test(lower);
  const visitorActionRequested = currentTurnDomain === "visitors"
    && /\b(create|invite|add|approve|deny|reject|revoke|cancel|extend|give|grant|allow|remove)\b/i.test(lower);
  const securityReadRequested = currentTurnDomain === "security"
    && /\b(what|why|show|list|view|status|has|is|are|any|alerts?|incidents?|issues?|history|unusual|gate|door|alarm|security|resolved|acknowledged)\b/i.test(lower)
    && !/\b(lock|unlock|disable|enable|acknowledge|acknowledged|escalate|assign|resolve|close|turn on|turn off)\b/i.test(lower);
  const securityActionRequested = currentTurnDomain === "security"
    && /\b(lock|unlock|disable|enable|acknowledge|escalate|assign|resolve|close|turn on|turn off)\b/i.test(lower);
  const serviceStatusQuestion = /\b(status|has|is|are|when|what|which|show|list|view|available|active|history|provider|technician|coming)\b/i.test(lower);
  const serviceTargetContext = currentTurnDomain === "services" || targetType === "service_account" || targetType === "meter";
  const serviceReadRequested = serviceTargetContext
    && /\b(what|which|when|show|list|view|status|has|is|are|available|active|requests?|bookings?|scheduled|history|provider|technician|coming)\b/i.test(lower)
    && !(/\b(book|schedule|request|cancel|reschedule|approve|modify|change|create|submit)\b/i.test(lower)
      && !(/\brequest\b/i.test(lower) && serviceStatusQuestion && !/\b(book|schedule|request a|create|submit|cancel|reschedule|approve|modify|change)\b/i.test(lower)));
  const serviceActionRequested = serviceTargetContext
    && /\b(book|schedule|request|cancel|reschedule|approve|modify|change|create|submit)\b/i.test(lower)
    && !(/\brequest\b/i.test(lower) && serviceStatusQuestion && !/\b(book|schedule|request a|create|submit|cancel|reschedule|approve|modify|change)\b/i.test(lower));
  const messageTargetContext = currentTurnDomain === "messages" || targetType === "message_thread";
  const communityTargetContext = currentTurnDomain === "community" || targetType === "community_post";
  const messageReadRequested = messageTargetContext
    && (/\b(tell me what|what did|what was|latest message|last message|unread|read|show|list|view|summari[sz]e|did anyone reply)\b/i.test(lower)
      || /\b(message|messages|inbox|thread|dm|direct message)\b/i.test(lower))
    && !(/\b(send|reply|draft|compose|post|tell)\b/i.test(lower) && !/\btell me\b/i.test(lower));
  const messageActionRequested = messageTargetContext
    && /\b(send|reply|draft|compose|message)\b/i.test(lower)
    && !/\b(tell me what|show|list|view|unread|latest|last message)\b/i.test(lower);
  const communityReadRequested = communityTargetContext
    && /\b(what(?: else)? did|what was|show|list|view|latest|announcements?|notices?|management updates?|community|residents group|posts?|summari[sz]e)\b/i.test(lower)
    && !/\b(send|reply|draft|compose|post this|tell residents|notify residents)\b/i.test(lower);
  const communityActionRequested = communityTargetContext
    && /\b(reply|draft|compose|post this|post to|tell (?:the )?residents|notify (?:the )?residents|announce)\b/i.test(lower)
    && !/\b(tell me what|what(?: else)? did|what was|show|list|view|latest)\b/i.test(lower);
  const sceneTargetContext = currentTurnDomain === "scenes" || targetType === "scene";
  const automationTargetContext = currentTurnDomain === "automations" || targetType === "automation";
  const scheduledAutomationLanguage = /\b(at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|midnight|every\s+(?:night|morning|day|weekday)|when i leave|when i arrive|daily|schedule)\b/i.test(lower);
  const sceneReadRequested = sceneTargetContext
    && /\b(what|which|show|list|view|status|history|last run|devices?|controls?|what(?:'s| is) in|details?)\b/i.test(lower)
    && !/\b(run|activate|start|create|make|edit|update|delete|remove)\b/i.test(lower);
  const sceneActionRequested = sceneTargetContext
    && /\b(run|activate|start)\b/i.test(lower)
    && !/\b(what|which|show|list|view|history|last run|what(?:'s| is) in)\b/i.test(lower);
  const sceneDraftRequested = sceneTargetContext
    && /\b(create|make|draft|prepare|edit|update|delete|remove)\b/i.test(lower);
  const automationReadRequested = automationTargetContext
    && /\b(what|why|when|which|show|list|view|status|history|last run|active|enabled|disabled|triggers?|conditions?|actions?|details?)\b/i.test(lower)
    && !/\b(create|make|draft|prepare|edit|update|delete|remove|enable|disable|pause|resume|turn (?:it|that|this).*(?:on|off))\b/i.test(lower);
  const automationActionRequested = automationTargetContext
    && (/\b(create|make|draft|prepare|edit|update|delete|remove|enable|disable|pause|resume)\b/i.test(lower)
      || /\bturn\s+(?:it|that|this|the)?\s*(?:routine|automation)?\s*(?:back\s+)?(?:on|off)\b/i.test(lower)
      || (scheduledAutomationLanguage && /\b(turn|switch|set|make)\b/i.test(lower)));
  const automationDraftFromTemporalDeviceRequest = !currentTurnDomain
    && scheduledAutomationLanguage
    && /\b(turn|switch|set|make)\b/i.test(lower);
  const mutationRequested = !semanticCandidate && !reportBroadTarget && !reportExactTarget && !maintenanceReadRequested && !visitorReadRequested && !visitorActionRequested && !securityReadRequested && !securityActionRequested && !serviceReadRequested && !serviceActionRequested && !messageReadRequested && !messageActionRequested && !communityReadRequested && !communityActionRequested && !sceneReadRequested && !sceneActionRequested && !sceneDraftRequested && !automationReadRequested && !automationActionRequested && !automationDraftFromTemporalDeviceRequest && isControlRequest(message) && !/\b(what happened|why|is|show|list|history|report|recommend|what can|changed|status|working|healthy|evidence|did that work|last command)\b/i.test(lower);
  const requestedChannel = mutationRequested ? requestedChannelCode(message) : null;
  const semanticOperation = !mutationRequested ? semanticCandidate : null;
  const targetAmbiguous = Boolean(targetResolution.ambiguous);
  const targetNotFound = Boolean(targetResolution.notFound);
  let intent: CanonicalIntent = "general_help";
  let operationClass: OperationClass = mutationRequested ? "execute_mutation" : "read";
  if (targetAmbiguous || (targetNotFound && mutationRequested)) {
    intent = targetNotFound ? "device_control" : "general_help";
    operationClass = "clarify";
  } else if (reportBroadTarget || reportExactTarget) {
    intent = "report";
    operationClass = "report";
  } else if (/\bhow much\b[\s\S]{0,60}\b(spent|spend|paid|pay)\b[\s\S]{0,60}\b(utilities|utility|electricity|power|water|internet|gas)\b/i.test(lower)) {
    intent = "wallet_operation";
    operationClass = "report";
  } else if (/\b(show|list|view)\b[\s\S]{0,30}\b(wallet|transaction|transactions|histry|history)\b/i.test(lower) || /\b(show|list|view)\s+wallet\s+history\b/i.test(lower)) {
    intent = /\bhistory|histry|transactions?\b/i.test(lower) ? "wallet_operation" : "domain_list";
    operationClass = "list";
  } else if (maintenanceReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (maintenanceActionRequested) {
    intent = "maintenance_operation";
    operationClass = "compose";
  } else if (visitorReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (visitorActionRequested) {
    intent = "visitor_operation";
    operationClass = "compose";
  } else if (securityReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (securityActionRequested) {
    intent = "security_operation";
    operationClass = "compose";
  } else if (serviceReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (serviceActionRequested) {
    intent = "service_operation";
    operationClass = "compose";
  } else if (messageReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (messageActionRequested) {
    intent = "message_operation";
    operationClass = "compose";
  } else if (communityReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (communityActionRequested) {
    intent = "community_operation";
    operationClass = "compose";
  } else if (sceneReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (sceneActionRequested) {
    intent = "scene_execution";
    operationClass = "compose";
  } else if (sceneDraftRequested) {
    intent = "scene_execution";
    operationClass = "compose";
  } else if (automationReadRequested) {
    intent = "domain_list";
    operationClass = "list";
  } else if (automationActionRequested || automationDraftFromTemporalDeviceRequest) {
    intent = "automation_operation";
    operationClass = "compose";
  } else if (semanticOperation) {
    intent = semanticOperation.intent;
    operationClass = semanticOperation.operationClass;
  } else if (["activity_history", "failure_history", "diagnosis", "relationships", "evidence", "current_state", "health_check", "command_outcome", "capability", "device_availability_inventory", "home_operational_summary"].includes(hint)) {
    intent = hint as CanonicalIntent;
    operationClass = "read";
  } else if (isReadOnlyBroadDeviceIntent(message)) {
    intent = "device_availability_inventory";
    operationClass = "report";
  } else if (targetType === "room" && /\bwhat(?:'s| is) happening|needs attention|summary|everything okay\b/i.test(lower)) {
    intent = "home_operational_summary";
    operationClass = "report";
  } else if (targetType === "room" && /\b(show|list|view)\b[\s\S]{0,24}\b(devices?|hardware|lights?|switches?|sockets?)\b/i.test(lower)) {
    intent = "device_availability_inventory";
    operationClass = "list";
  } else if (targetType === "room" && /\bwhat changed|changed recently|recent changes|activity|history\b/i.test(lower)) {
    intent = "recent_changes";
    operationClass = "list";
  } else if (explicitBroad && /\bwhat(?:'s| is) happening|needs attention|home summary|home report|everything okay\b/i.test(lower)) {
    intent = "home_operational_summary";
    operationClass = "report";
  } else if (/\b(report|generate.*report|summary report)\b/i.test(lower)) {
    intent = "report";
    operationClass = "report";
  } else if (/\b(recommend|what should|next step|suggest)\b/i.test(lower)) {
    intent = "recommendation";
    operationClass = "recommend";
  } else if (/\bwhat changed|changed recently|recent changes\b/i.test(lower)) {
    intent = "recent_changes";
  } else if (/\b(last command|what happened to.*command|did that work|did it work|command outcome)\b/i.test(lower)) {
    intent = "command_outcome";
  } else if (/\b(show|view|list|check)\b[\s\S]{0,24}\b(failures?|errors?|timeouts?|rejections?)\b|\bfailures?\b/i.test(lower)) {
    intent = "failure_history";
  } else if (/\b(activity|history|what happened|timeline)\b/i.test(lower)) {
    intent = "activity_history";
  } else if (/\b(diagnose|diagnosis|check connection|investigate)\b/i.test(lower)) {
    intent = "diagnosis";
  } else if (/\b(relationship|relationships|what controls|where.*belong|scene|automation|dependencies)\b/i.test(lower)) {
    intent = "relationships";
  } else if (/\bwhy|explain|reason|investigate|what caused\b/i.test(lower)) {
    intent = /\binvestigate|why\b/i.test(lower) ? "investigation" : "explanation";
  } else if (/\bevidence|how do you know|are you sure|confirmed|last updated\b/i.test(lower)) {
    intent = "evidence";
  } else if (/\bworking|healthy|health|status|online|offline|unavailable|is this|is it|is everything okay\b/i.test(lower)) {
    intent = /\bworking|healthy|health\b/i.test(lower) ? "health_check" : "current_state";
  } else if (/\bwhat can|help|capabilit|controls this|what controls|relationship|scene|automation\b/i.test(lower)) {
    intent = /\bwhat can|help|capabilit\b/i.test(lower) ? "capability" : "capability";
  } else if (mutationRequested) {
    intent = "device_control";
  }
  if (operationHint === "read") operationClass = "read";
  if (!["execute_mutation", "confirm_mutation", "propose_mutation", "compose", "approve", "reject", "cancel", "handoff", "report", "recommend", "navigate", "list", "clarify"].includes(operationClass)) operationClass = "read";
  const scopeMode: ScopeMode = targetAmbiguous || (targetNotFound && mutationRequested)
    ? "clarification"
    : intent === "wallet_operation"
    ? "home_scope"
    : reportBroadTarget
    ? input.surface === "facility" || recordOf(input.context).building_id || /\b(building|facility|estate|portfolio)\b/i.test(lower)
      ? input.estate_id && !recordOf(input.context).building_id && /\bestate|portfolio\b/i.test(lower)
        ? "estate_scope"
        : "building_scope"
      : "home_scope"
    : targetType === "home"
    ? "home_scope"
    : targetType === "room"
    ? "room_scope"
    : semanticOperation
    ? semanticOperation.scopeMode
    : scopeHint === "exact_target" && targetType && !explicitBroad
    && !semanticOperation
    ? "exact_target"
    : explicitBroad
    ? "home_scope"
    : targetType
      ? "exact_target"
      : input.room_id
        ? "room_scope"
        : input.home_id
          ? "home_scope"
          : input.estate_id
            ? "estate_scope"
            : "global_scope";
  const answerBuilder = targetAmbiguous || (targetNotFound && mutationRequested)
    ? "clarification"
    : intent === "wallet_operation" && /\butilities|utility|electricity|power|water|internet|gas\b/i.test(lower)
    ? "utility_spending"
    : intent === "wallet_operation"
    ? "wallet_history"
    : semanticOperation
    ? semanticOperation.answerBuilder
    : intent === "report"
    ? "canonical_report_builder"
    : intent === "home_operational_summary"
      ? "home_operational_summary"
      : intent === "device_availability_inventory"
        ? "device_availability_inventory"
    : intent === "recent_changes" || intent === "activity_history"
      ? "recent_changes"
      : intent === "failure_history"
        ? "failure_history"
        : intent === "diagnosis" || intent === "investigation" || intent === "explanation"
          ? "device_diagnosis"
          : intent === "relationships"
            ? "device_relationships"
      : intent === "command_outcome"
        ? "command_outcome"
        : intent === "health_check"
          ? "device_health"
          : intent === "current_state"
            ? "current_state"
            : intent === "capability"
              ? "capability"
              : intent === "recommendation"
                ? "recommendation"
                : intent === "device_control" || intent === "scene_execution"
                  ? "canonical_action_execution"
                  : "general";
  const targetParentId = object?.parent_id || parsedChannel.parent_id;
  const targetChannelCode = requestedChannel || parsedChannel.channel_code || text(recordOf(object?.metadata).channel_code) || null;
  const targetCanonicalId = requestedChannel && targetParentId
    ? `${targetParentId}:${requestedChannel}`
    : targetId;
  const targetLabel = requestedChannel && object?.label
    ? object.label.replace(/Channel\s+[123]/i, requestedChannel.replace(/^switch_/i, "Channel "))
    : object?.label || text(targetResolution.objectName) || null;
  const semanticBroadTarget = Boolean(semanticOperation && semanticOperation.scopeMode === "home_scope" && semanticOperation.operationClass === "list");
  const domainBroadTarget = Boolean(
    ["maintenance", "visitors", "security", "services", "messages", "community", "scenes", "automations", "reports"].includes(currentTurnDomain || "")
    && !reportExactTarget
    && ["list", "report"].includes(operationClass)
    && /\b(all|any|show|list|unresolved|open|expected|pending|alerts?|incidents?|issues?|requests?|services?|bookings?|messages?|threads?|announce(?:d)?|announcements?|notices?|community|posts?|residents group|scenes?|automations?|routines?|schedules?|reports?|analytics?|trends?|comparison|performance)\b/i.test(lower),
  );
  const retainedTargetType = semanticBroadTarget || domainBroadTarget || reportBroadTarget ? null : targetType;
  return {
    conversation_request_id: conversationRequestId,
    thread_id: text(input.thread_id) || null,
    surface: input.surface,
    operation_class: operationClass,
    intent,
    scope_mode: scopeMode,
    temporal_scope: temporalScopeFor(message),
    target: {
      object_type: retainedTargetType,
      canonical_id: retainedTargetType ? targetCanonicalId : null,
      parent_id: retainedTargetType ? targetParentId : null,
      channel_code: retainedTargetType ? targetChannelCode : null,
      label: retainedTargetType ? targetLabel : null,
    },
    mutation: {
      requested: mutationRequested,
      confirmed: /^(yes|yep|confirm|go ahead|do it|continue|execute)$/i.test(message),
      command: requestedPowerState(message) || null,
      desired_state: requestedPowerState(message) || null,
      risk_class: mutationRequested ? "control" : null,
    },
    evidence_requirements: {
      current_state: ["current_state", "health_check", "evidence", "report"].includes(intent),
      recent_events: ["recent_changes", "activity_history", "failure_history", "diagnosis", "investigation", "report"].includes(intent),
      execution_history: ["command_outcome", "recent_changes", "activity_history", "failure_history", "diagnosis", "investigation", "report"].includes(intent),
      audit_history: ["recent_changes", "activity_history", "failure_history", "report"].includes(intent),
      relationships: ["capability", "relationships", "recommendation", "report"].includes(intent),
      permissions: true,
      provider_state: ["current_state", "health_check", "device_control"].includes(intent),
      financial_ledger: ["wallet_operation", "report"].includes(intent),
      access_records: ["visitor_operation", "access_operation", "report"].includes(intent),
    },
    answer_builder: answerBuilder,
    report_builder: intent === "report" || intent === "home_operational_summary" || intent === "device_availability_inventory" ? `${scopeMode}_operational_report` : null,
    truth_policy: operationClass === "execute_mutation" ? "current_turn_execution_required" : "read_only_no_execution",
    confidence: semanticOperation ? 0.92 : Number(targetResolution.confidence) || (explicitBroad ? 0.9 : 0.76),
    ambiguity: targetAmbiguous || (targetNotFound && mutationRequested)
      ? {
        required: true,
        reason: targetNotFound ? "not_found" : "ambiguous",
        question: targetNotFound
          ? `I could not find a device called “${targetLabel || text(targetResolution.objectName) || "that"}” in this home. No command was sent.`
          : text(targetResolution.clarificationQuestion) || `Which ${targetLabel || "device"} do you mean?`,
        candidates: Array.isArray(targetResolution.candidates) ? targetResolution.candidates as Array<Record<string, unknown>> : [],
      }
      : undefined,
  };
}

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  };
}

function exactTargetLiveReadIntent(contract: IntelligenceRequestContract) {
  return contract.scope_mode === "exact_target"
    && contract.operation_class === "read"
    && ["current_state", "health_check", "diagnosis", "investigation", "evidence"].includes(contract.intent);
}

function parentDeviceIdForContract(contract: IntelligenceRequestContract, object: OperationalObject | null) {
  if (object?.object_type === "device_channel") return object.parent_id || object.canonical_id.split(":")[0];
  if (object?.object_type === "device") return object.canonical_id;
  if (contract.target.object_type === "device_channel" && contract.target.canonical_id) return contract.target.parent_id || contract.target.canonical_id.split(":")[0];
  if (contract.target.object_type === "device" && contract.target.canonical_id) return contract.target.canonical_id;
  return "";
}

export async function requestBoundedLiveEvidence(input: {
  contract: IntelligenceRequestContract;
  object: OperationalObject | null;
  conversationTarget: any;
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  activeContext: Record<string, unknown>;
  visibleState: Record<string, unknown> | null;
}) {
  if (!exactTargetLiveReadIntent(input.contract) || !input.object) return null;
  const freshness = text(input.object.freshness).toLowerCase();
  if (freshness === "fresh") return null;
  const deviceId = parentDeviceIdForContract(input.contract, input.object);
  if (!deviceId) return null;
  const startedAt = Date.now();
  logger.info("conversation_live_evidence_requested", {
    conversation_request_id: input.contract.conversation_request_id,
    device_id: deviceId,
    target_id: input.contract.target.canonical_id,
    intent: input.contract.intent,
    existing_freshness: input.object.freshness,
  });
  try {
    const refreshPromise = deviceRuntimeStateService.refresh(deviceId, "high", "conversation_exact_target_live_read");
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800));
    const refreshed = await Promise.race([refreshPromise, timeoutPromise]);
    if (!refreshed) {
      logger.info("conversation_live_evidence_timed_out", {
        conversation_request_id: input.contract.conversation_request_id,
        device_id: deviceId,
        duration_ms: Date.now() - startedAt,
      });
      return null;
    }
    logger.info("conversation_live_evidence_completed", {
      conversation_request_id: input.contract.conversation_request_id,
      device_id: deviceId,
      source: refreshed.source,
      freshness: refreshed.freshness,
      age_ms: refreshed.age_ms,
      duration_ms: Date.now() - startedAt,
    });
    return hydrateCanonicalTarget({
      actor: input.actor,
      oisContext: input.oisContext,
      target: input.conversationTarget,
      activeContext: input.activeContext,
      visibleState: input.visibleState,
    });
  } catch (error) {
    logger.info("conversation_live_evidence_timed_out", {
      conversation_request_id: input.contract.conversation_request_id,
      device_id: deviceId,
      reason: error instanceof Error ? error.message : "refresh_failed",
      duration_ms: Date.now() - startedAt,
    });
    return null;
  }
}

export function factFromObject(object: OperationalObject, hydrationFacts: Record<string, unknown>, input: CanonicalConversationRequest, oisContext: OisContext | null | undefined): IntelligenceFact {
  return factFromOperationalObject(object, hydrationFacts, input, oisContext, { objectStateLine });
}

export function factAppliesToContract(fact: IntelligenceFact, contract: IntelligenceRequestContract) {
  return evaluateFactCompatibility(fact, contract).compatible;
}

export function evaluateFactCompatibility(fact: IntelligenceFact, contract: IntelligenceRequestContract): { compatible: boolean; reason: string } {
  if (contract.scope_mode !== "exact_target" || !contract.target.canonical_id) return { compatible: true, reason: "scope_level_fact" };
  const haystack = `${fact.statement} ${fact.fact_type} ${fact.source_id || ""}`.toLowerCase();
  if (/ai\.|oyi\.system|proximity\.awareness|tool\.requested|tool\.executed|response\.generated|command\.received|audit\.recorded/.test(haystack)) {
    return { compatible: false, reason: "internal_or_proximity_noise" };
  }
  const factId = fact.object?.canonical_id || "";
  const parentId = contract.target.parent_id || contract.target.canonical_id.split(":")[0];
  if (contract.target.object_type === "device_channel" && contract.target.channel_code) {
    const compatible = factId === contract.target.canonical_id
      || (factId === parentId && text(recordOf(fact.value).channel_code) === contract.target.channel_code)
      || (factId.startsWith(`${parentId}:`) && factId.endsWith(`:${contract.target.channel_code}`));
    return { compatible, reason: compatible ? "exact_channel_match" : "different_channel_or_device" };
  }
  const compatible = factId === contract.target.canonical_id || factId.startsWith(`${contract.target.canonical_id}:`);
  return { compatible, reason: compatible ? "exact_device_match" : "different_device" };
}

export function isUsefulDeviceActivityFact(fact: IntelligenceFact) {
  const haystack = `${fact.statement} ${fact.fact_type} ${fact.source_id || ""}`.toLowerCase();
  if (/ai\.|oyi\.system|proximity\.awareness|tool\.requested|tool\.executed|response\.generated|command\.received|audit\.recorded/.test(haystack)) return false;
  if (!safeDateLabel(fact.occurred_at, "")) {
    return /critical|failed|rejected|confirmed offline|alarm|security/i.test(haystack);
  }
  if (/system event/.test(haystack)) return false;
  return /command|confirmed|changed|connected|disconnected|failed|rejected|scene|automation|offline|online|maintenance|fault|timeout/.test(haystack);
}

export function isFailureFact(fact: IntelligenceFact) {
  const haystack = `${fact.statement} ${JSON.stringify(fact.value)} ${fact.truth_state}`.toLowerCase();
  return /provider_rejected|authentication|device_not_linked|integration_expired|command failure|failed|state_mismatch|confirmation_timed_out|timeout|runtime refresh failed|confirmed offline|capability mismatch|rejected/.test(haystack)
    && !/\b(stale|expired|unknown)\b/.test(haystack.replace(/confirmation_timed_out/g, ""));
}

export const presentationFactPredicates: PresentationFactPredicates = {
  factAppliesToContract,
  isResidentVisibleOperationalFact,
  isUsefulDeviceActivityFact,
  securityRiskAllowed,
};

export function stripInternalLanguage(value: string) {
  const blocked = [
    /oyi compatibility awareness/gi,
    /compatibility awareness/gi,
    /execution ledger(?: record)?(?: is)?(?: not)?(?: currently)?(?: attached)?/gi,
    /compatibility source/gi,
    /synthetic signal/gi,
    /internal enum/gi,
    /signal normalization/gi,
  ];
  let next = value;
  for (const pattern of blocked) {
    if (pattern.test(next)) logger.info("conversation_internal_language_blocked", { pattern: String(pattern) });
    next = next.replace(pattern, "available evidence");
  }
  return next.replace(/\s+/g, " ").trim();
}

export function enforceResidentAnswerQuality(answer: string, fallback: string) {
  const checks: Array<[string, RegExp]> = [
    ["raw_uuid", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}\b/i],
    ["invalid_date", /\bInvalid Date\b/i],
    ["undefined_null", /\b(undefined|null)\b/i],
    ["internal_event_code", /\b(?:ai|oyi|device|audit|proximity|runtime)\.[a-z0-9_.-]+\b/i],
    ["privacy_policy_term", /\bprivacy_class|resident_device_private|organization_restricted|permitted surface|Facility projection\b/i],
    ["duplicate_timestamp", /\b([0-9]{1,2}:[0-9]{2}\s?(?:AM|PM)?)\s*\(\s*\1\s*\)/i],
    ["freshness_contradiction", /cannot claim a live healthy connection[\s\S]{0,220}(controller connection is healthy|is healthy|currently reports)/i],
  ];
  for (const [category, pattern] of checks) {
    if (pattern.test(answer)) {
      logger.warn("conversation_answer_quality_blocked", { category });
      return fallback;
    }
  }
  return answer;
}

export function buildCapabilityAnswer(object: OperationalObject | null, input: CanonicalConversationRequest) {
  return buildSurfaceCapabilityAnswer({ object, request: input, objectCapabilityLine });
}

export function operationForResolvedTurn(contract: IntelligenceRequestContract): ConversationOperation {
  if (contract.operation_class === "navigate") return contract.target.object_type ? "navigate_object" : "navigate_module";
  if (contract.operation_class === "list") return "list";
  if (contract.operation_class === "execute_mutation" || contract.operation_class === "confirm_mutation") return "control";
  if (contract.operation_class === "propose_mutation" || contract.operation_class === "compose") return "compose";
  if (contract.operation_class === "approve") return "approve";
  if (contract.operation_class === "reject") return "reject";
  if (contract.operation_class === "handoff") return "handoff";
  if (contract.scope_mode === "clarification") return "clarify";
  if (contract.intent === "wallet_operation") return "list";
  if (contract.intent === "device_availability_inventory" || contract.intent === "recent_changes" || contract.intent === "activity_history" || contract.intent === "failure_history") return "list";
  if (contract.intent === "current_state" || contract.intent === "health_check" || contract.intent === "diagnosis" || contract.intent === "relationships" || contract.intent === "evidence") return "inspect";
  return "inform";
}

export function scopeForResolvedTurn(contract: IntelligenceRequestContract): ResolvedConversationTurn["scope"] {
  if (contract.scope_mode === "exact_target") return "exact_object";
  if (contract.scope_mode === "room_scope") return "room";
  if (contract.scope_mode === "home_scope" || contract.scope_mode === "explicit_broad_scope") return "home";
  if (contract.scope_mode === "building_scope" || contract.scope_mode === "estate_scope") return "building";
  if (contract.scope_mode === "thread_scope") return "thread_reference";
  if (contract.scope_mode === "clarification") return "ambiguous";
  if (contract.intent === "module_navigation" || contract.intent === "domain_list") return "module";
  return "home";
}

export function domainForResolvedTurn(contract: IntelligenceRequestContract, object: OperationalObject | null, semantic?: ReturnType<typeof semanticOperationAction> | null, message = "") {
  const currentTurnDomain = domainForCurrentTurn(message);
  if (["maintenance", "visitors", "security", "services", "community", "messages", "notifications", "scenes", "automations", "reports"].includes(currentTurnDomain || "")) return currentTurnDomain;
  if (semantic?.operation?.domain) return semantic.operation.domain;
  const module = text(object?.source_module).toLowerCase();
  const targetType = text(contract.target.object_type).toLowerCase();
  if (module) return module;
  if (/device|switch|camera/.test(targetType)) return "devices";
  if (/room/.test(targetType)) return "rooms";
  if (/visitor|access/.test(targetType)) return "visitors";
  if (/maintenance/.test(targetType)) return "maintenance";
  if (/wallet|transaction/.test(targetType)) return "wallet";
  if (/incident/.test(targetType)) return "incidents";
  if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") return "utilities";
  if (contract.intent === "wallet_operation") return "wallet";
  if (contract.intent === "maintenance_operation") return "maintenance";
  if (contract.intent === "visitor_operation" || contract.intent === "access_operation") return "visitors";
  if (contract.intent === "security_operation") return "security";
  if (contract.intent === "service_operation") return "services";
  if (contract.intent === "community_operation") return "community";
  if (contract.intent === "message_operation") return "messages";
  if (contract.intent === "notification_operation") return "notifications";
  if (contract.intent === "scene_execution") return "scenes";
  if (contract.intent === "automation_operation") return "automations";
  if (contract.intent === "report") return "reports";
  if (contract.intent === "domain_list") return domainForCurrentTurn(message);
  if (contract.intent === "device_availability_inventory") return "devices";
  return null;
}

export function presentationPolicyForContract(contract: IntelligenceRequestContract): ConversationPresentationPolicy {
  const base = {
    intent: contract.intent,
    operation: operationForResolvedTurn(contract),
  };
  if (contract.scope_mode === "clarification") {
    return { ...base, primary: "clarification", allowed_supporting_blocks: ["clarification"], allowed_action_types: ["clarification_choice"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "hidden", snapshot_mode: "none", auto_navigation: false };
  }
  if (contract.operation_class === "execute_mutation" || contract.operation_class === "confirm_mutation") {
    return { ...base, primary: "approval", allowed_supporting_blocks: ["approval", "command_result"], allowed_action_types: ["approval", "cancel"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "none", auto_navigation: false };
  }
  if ((contract.intent === "message_operation" || contract.intent === "community_operation" || contract.intent === "scene_execution" || contract.intent === "automation_operation") && contract.operation_class === "compose") {
    return { ...base, primary: "review", allowed_supporting_blocks: ["review", "navigation_action"], allowed_action_types: ["edit", "cancel", "approval"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "none", auto_navigation: false };
  }
  if (contract.intent === "device_availability_inventory" || contract.intent === "recent_changes" || contract.intent === "activity_history" || contract.intent === "failure_history" || contract.intent === "wallet_operation") {
    return { ...base, primary: "table", allowed_supporting_blocks: ["table", "navigation_action"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: contract.intent === "device_availability_inventory" ? "current_state_snapshot" : "historical", auto_navigation: false };
  }
  if (contract.intent === "module_navigation") {
    return { ...base, primary: "navigation_transition", allowed_supporting_blocks: ["navigation_action", "handoff"], allowed_action_types: ["navigation", "stay"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "hidden", snapshot_mode: "none", auto_navigation: true };
  }
  if ((contract.intent === "capability" || contract.intent === "general_help") && (contract.scope_mode === "home_scope" || contract.scope_mode === "global_scope")) {
    return { ...base, primary: "text", allowed_supporting_blocks: ["navigation_action"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "hidden", snapshot_mode: "none", auto_navigation: false };
  }
  if (contract.intent === "domain_list") {
    return { ...base, primary: "text", allowed_supporting_blocks: ["navigation_action"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "historical", auto_navigation: false };
  }
  if (contract.intent === "current_state" || contract.intent === "health_check") {
    return { ...base, primary: "status", allowed_supporting_blocks: ["status", "evidence"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: false, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "current_state_snapshot", auto_navigation: false };
  }
  return { ...base, primary: "text", allowed_supporting_blocks: ["object_card", "evidence", "navigation_action"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: false, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "none", auto_navigation: false };
}

export function selectConversationBuilder(contract: IntelligenceRequestContract, object: OperationalObject | null): ConversationBuilderKey | null {
  const objectType = text(object?.object_type || contract.target.object_type);
  const exactDevice = contract.scope_mode === "exact_target" && (objectType === "device" || objectType === "device_channel");
  if (exactDevice && ["current_state", "health_check", "evidence"].includes(contract.intent)) return "device_status";
  if (exactDevice && ["activity_history", "recent_changes"].includes(contract.intent)) return "device_activity";
  if (exactDevice && contract.intent === "failure_history") return "device_failures";
  if (exactDevice && ["diagnosis", "investigation", "explanation"].includes(contract.intent)) return "device_diagnosis";
  if (exactDevice && contract.intent === "relationships") return "device_relationships";
  if (exactDevice && contract.intent === "device_control") return "device_control";
  if (contract.intent === "device_availability_inventory") return "offline_inventory";
  if (contract.intent === "home_operational_summary") return "home_summary";
  if (contract.intent === "recent_changes" || contract.intent === "activity_history") return "recent_changes";
  if (contract.intent === "wallet_operation" && contract.answer_builder === "wallet_history") return "wallet_history";
  if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") return "utility_spending";
  if (contract.intent === "wallet_operation") return "wallet_summary";
  if (contract.intent === "module_navigation") return "module_navigation";
  if (contract.intent === "domain_list") return "domain_list";
  if (contract.scope_mode === "clarification") return "clarification";
  if (contract.intent === "general_help" || contract.intent === "capability") return "general_help";
  return null;
}

export function targetSourceForResolvedOyiTurn(source: unknown): ResolvedOyiTurn["target_source"] {
  const raw = text(source);
  if (raw === "current_turn_room_reference" || raw === "resolved_named_reference" || raw === "home_scope") return "current_turn";
  if (raw === "thread_state") return "thread_memory";
  if (raw === "page_selection" || raw === "active_page_object" || raw === "selected_subobject") return "page_context";
  if (raw === "clarification" || raw === "ambiguous") return "active_workflow";
  if (raw === "global_scope" || raw === "estate_scope") return "authorised_fallback";
  return "valid_reference";
}

export function canonicalTargetFromContract(contract: IntelligenceRequestContract, object: OperationalObject | null): CanonicalTarget | null {
  const objectType = text(contract.target.object_type || object?.object_type);
  const canonicalId = text(contract.target.canonical_id || object?.canonical_id);
  if (!objectType || !canonicalId) return null;
  return {
    object_type: objectType,
    canonical_id: canonicalId,
    label: text(contract.target.label || object?.label) || null,
    parent_id: text(contract.target.parent_id || object?.parent_id) || null,
    channel_code: text(contract.target.channel_code || recordOf(object?.metadata).channel_code) || null,
  };
}

export function resolvedOyiTurnFromContract(input: CanonicalConversationRequest, normalizedTurn: NormalizedUserTurn, contract: IntelligenceRequestContract, object: OperationalObject | null, options: { targetSource: unknown; workflowId?: string | null }): ResolvedOyiTurn {
  const semanticDomain = normalizedTurn.domain || (domainForResolvedTurn(contract, object, semanticOperationAction(input.message || "", input.surface)) as OyiDomain | null);
  const capabilityKey = capabilityKeyForTurn({ ...normalizedTurn, domain: semanticDomain || normalizedTurn.domain || "global" });
  return {
    request_id: contract.conversation_request_id,
    thread_id: text(contract.thread_id) || text(input.thread_id) || "",
    operation: normalizedTurn.operation,
    domain: semanticDomain,
    capability_key: capabilityKey,
    scope: {
      estate_id: input.estate_id || null,
      building_id: text(recordOf(input.context).building_id || recordOf(input.context).buildingId) || null,
      home_id: input.home_id || null,
      room_id: input.room_id || object?.room_id || null,
    },
    target: canonicalTargetFromContract(contract, object),
    target_source: targetSourceForResolvedOyiTurn(options.targetSource),
    temporal_scope: contract.temporal_scope || null,
    authority: decideAuthorityForTurn({ ...normalizedTurn, domain: semanticDomain || normalizedTurn.domain || "global" }),
    workflow_id: options.workflowId || null,
    presentation_policy: presentationPolicyForContract(contract),
  };
}

export function workflowForResolvedTurn(input: CanonicalConversationRequest, normalizedTurn: NormalizedUserTurn, contract: IntelligenceRequestContract, object: OperationalObject | null, resolvedTurn: ResolvedOyiTurn): OyiWorkflow {
  const unresolvedInputs = contract.scope_mode === "clarification"
    ? ["target"]
    : contract.operation_class === "compose"
      ? ["review_details"]
      : contract.operation_class === "execute_mutation" && !contract.mutation.confirmed
        ? ["approval"]
        : [];
  return createWorkflow({
    thread_id: resolvedTurn.thread_id || text(input.thread_id) || randomUUID(),
    request_id: contract.conversation_request_id,
    capability_key: resolvedTurn.capability_key,
    domain: (resolvedTurn.domain || normalizedTurn.domain || "global") as OyiDomain,
    operation: normalizedTurn.operation,
    target: canonicalTargetFromContract(contract, object),
    unresolved_inputs: unresolvedInputs,
    authority_decision: resolvedTurn.authority,
    proposed_action: contract.mutation.requested ? {
      command: contract.mutation.command,
      desired_state: contract.mutation.desired_state,
      risk_class: contract.mutation.risk_class,
    } : null,
    ttl_ms: unresolvedInputs.length ? 30 * 60 * 1000 : null,
  });
}

export function resolvedConversationTurnFromContract(input: CanonicalConversationRequest, contract: IntelligenceRequestContract, object: OperationalObject | null): ResolvedConversationTurn {
  const semantic = semanticOperationAction(input.message, input.surface);
  const destination = semantic?.operation?.destination
    ? { key: semantic.operation.destination.key, parameters: recordOf(semantic.operation.parameters) as Record<string, string> }
    : null;
  const presentation = presentationPolicyForContract(contract);
  const operation = semantic && contract.operation_class === "navigate"
    ? semantic.operation.destination.mode === "module" ? "navigate_module" : "navigate_object"
    : operationForResolvedTurn(contract);
  return {
    rawMessage: text(input.message),
    intent: contract.intent,
    operation,
    scope: destination && contract.operation_class === "navigate" && semantic?.operation.destination.mode === "detail" ? "room" : scopeForResolvedTurn(contract),
    domain: domainForResolvedTurn(contract, object, semantic, input.message),
    object: contract.target.canonical_id && contract.target.object_type ? {
      type: contract.target.object_type,
      id: contract.target.canonical_id,
      label: contract.target.label,
      parent_id: contract.target.parent_id,
      room_id: object?.room_id || null,
      channel_code: contract.target.channel_code,
    } : null,
    destination,
    ambiguity: {
      required: contract.scope_mode === "clarification" || Boolean(contract.ambiguity?.required),
      question: contract.ambiguity?.question || null,
      candidates: (contract.ambiguity?.candidates || []).map((candidate) => ({
        type: text(candidate.object_type || candidate.type || "device"),
        id: text(candidate.device_id || candidate.id),
        label: cleanLabel(candidate.label, "Device"),
        detail: text(candidate.room_label || candidate.detail || candidate.device_family) || null,
      })),
    },
    authority: {
      allowed: !semantic || semantic.allowed,
      required_permission: semantic?.operation.destination.required_permission || null,
      confirmation_required: contract.mutation.requested || contract.mutation.confirmed,
      secure_review_required: /wallet|access|credential|payment|financial/i.test(`${contract.intent} ${contract.target.object_type || ""}`),
      denial_reason: semantic && !semantic.allowed ? "destination_not_available_on_surface" : null,
    },
    presentation: { mode: presentation.primary },
    temporal_scope: contract.temporal_scope,
    confidence: contract.confidence,
  };
}
