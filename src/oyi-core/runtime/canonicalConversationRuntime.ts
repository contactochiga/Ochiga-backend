import { randomUUID } from "crypto";
import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import { logger } from "../../observability/logger";
import { operationalMetrics } from "../../observability/metrics";
import {
  loadOyiConversationContext,
  runOyiUnifiedChat,
  type OyiChatInput,
  type OyiSurface,
} from "../../services/oyiUnifiedIntelligenceService";
import { buildModuleFacts } from "./moduleFactAdapters";
import {
  namedDevicePhraseFromControlMessage,
  requestedChannelCode,
  resolveConversationTarget,
  resolveNamedDeviceForRead,
  resolveRoomForRead,
  roomPhraseFromMessage,
  type DeviceResolutionResult,
  type RoomResolutionResult,
} from "./conversationTargetResolver";
import { hydrateCanonicalTarget } from "./canonicalTargetHydrationRegistry";
import { deviceRuntimeStateService } from "../../services/deviceRuntimeStateService";
import { normalizeUserTurn, type OyiDomain } from "./languageUnderstanding";
import { getDomainCapability, type AuthorityDecision } from "./domainCapabilityRegistry";
import {
  buildCapabilityAnswer,
  currentTurnAllowsDeviceResolution,
  domainForResolvedTurn,
  enforceResidentAnswerQuality,
  factAppliesToContract,
  factFromObject,
  interpretSemanticOperation,
  isFailureFact,
  parseDeviceChannelIdentity,
  presentationFactPredicates,
  presentationPolicyForContract,
  requestBoundedLiveEvidence,
  resolveIntentContract,
  resolvedConversationTurnFromContract,
  resolvedOyiTurnFromContract,
  selectConversationBuilder,
  semanticOperationAction,
  stripInternalLanguage,
  workflowForResolvedTurn,
} from "./canonicalTurnResolution";
import { freshnessLabelFromEvidence } from "../presentation/timeFreshness";
import {
  buildCommandOutcomeAnswer,
  buildDeviceAvailabilityInventoryAnswer,
  buildHomeOperationalSummaryAnswer,
  buildRecentChangesAnswer,
  buildWalletHistoryAnswer,
  tableBlockForContract,
  type ConversationTableBlock,
  type PresentationFactPredicates,
} from "../presentation/conversationAnswerPresentation";
import {
  currentTurnExplicitlyGlobal,
  domainForCurrentTurn,
  isExplicitBroadHomeReadIntent,
  isReadOnlyBroadDeviceIntent,
  type IntelligenceRequestContract,
} from "../interpretation/conversationIntentRouting";
import {
  turnInterpretationFromContract,
  type ConversationContextLayers,
  type TurnInterpretation,
} from "../context/conversationContextLayers";
import {
  constructBroadScopeObject,
  explicitObjectCandidate,
  sanitizeConversationInputTargets,
  threadObjectCandidate,
} from "../context/conversationTargetCandidates";
import {
  canInheritedExactTargetSatisfyCurrentTurn,
  currentTurnReferencesInheritedTarget,
  isControlRequest,
  isExplanationRequest,
  resolveCurrentTurnAuthorityDecision,
} from "../context/currentTurnAuthority";
import {
  hydrateOperationalObjectCandidate,
  type ConversationObjectCandidate as ObjectCandidate,
  type ResolvedOperationalObject,
} from "../context/conversationObjectHydration";
import {
  buildDeviceControlProposal,
  buildDeviceCurrentStateAnswer,
  buildDeviceDiagnosisAnswer,
  buildDeviceFailureHistoryAnswer,
  buildDeviceHealthAnswer,
  buildDeviceRelationshipsAnswer,
} from "../domains/devices/deviceConversationAnswers";
import {
  dedupeIntelligenceFacts as dedupeFacts,
  factFromOperationalObject,
  isResidentVisibleOperationalFact,
  loadHomeDeviceInventoryFacts,
  loadLatestCommandFact,
  loadRecentDeviceChangeFacts as loadRecentChangeFacts,
} from "../domains/devices/deviceEvidence";
import {
  maintenanceConfirmationReply,
  maintenanceContextualActions,
  maintenanceLinkedIssueSummary,
  maintenanceObjectProfile,
  maintenanceObjectVoice,
  maintenanceRecommendation,
} from "../domains/maintenance/maintenanceConversationAnswers";
import { unresolvedMaintenanceRecordsForContext } from "../domains/maintenance/maintenanceEvidence";
import { buildUtilitySpendingAnswer } from "../domains/utilities/utilityConversationAnswers";
import { loadUtilitySpendingFacts } from "../domains/utilities/utilityEvidence";
import { loadWalletTransactionFacts } from "../domains/wallet/walletEvidence";
import {
  visitorConfirmationReply,
  visitorContextualActions,
  visitorObjectProfile,
  visitorObjectVoice,
  visitorRecommendation,
} from "../domains/visitors/visitorConversationAnswers";
import {
  securityConfirmationReply,
  securityContextualActions,
  securityObjectProfile,
  securityObjectVoice,
  securityRecommendation,
} from "../domains/security/securityConversationAnswers";
import { securityRiskAllowed } from "../domains/security/securityEvidence";
import {
  serviceConfirmationReply,
  serviceContextualActions,
  serviceObjectProfile,
  serviceObjectVoice,
  serviceRecommendation,
} from "../domains/services/serviceConversationAnswers";
import {
  communityConfirmationReply,
  communityContextualActions,
  buildCommunityReadAnswer,
  communityObjectProfile,
  communityObjectVoice,
  communityRecommendation,
} from "../domains/community/communityConversationAnswers";
import { communityRecordsFromContext } from "../domains/community/communityEvidence";
import {
  buildSceneAutomationReadAnswer,
  buildSceneAutomationReviewAnswer,
  sceneAutomationConfirmationReply,
  sceneAutomationContextualActions,
  sceneAutomationObjectProfile,
  sceneAutomationObjectVoice,
  sceneAutomationRecommendation,
} from "../domains/automations/sceneAutomationConversationAnswers";
import { sceneAutomationRecordsFromContext } from "../domains/automations/sceneAutomationEvidence";
import { buildReportAnswer } from "../domains/reports/reportConversationAnswers";
import { isBroadReportRequest, loadReportEvidence } from "../domains/reports/reportEvidence";
import { buildSurfaceCapabilityAnswer } from "../policy/surfaceConversationPolicy";
import {
  buildGenericRecommendationAnswer,
  contextualObjectActions,
  listNames,
  naturalizeUserCopy,
  objectCapabilityLine,
  objectStateLine,
  shapeObjectConversation,
} from "../presentation/objectFallbackPresentation";
import { persistCanonicalConversationTurn } from "../persistence/canonicalConversationPersistence";
import { canonicalTruthFor } from "../persistence/canonicalConversationTruth";
import {
  buildClarificationContinuationResponse,
  matchPendingClarificationCandidate,
  pendingClarificationFromThread,
  pendingClarificationWorkflow,
  userCancelledClarification,
} from "../workflows/conversationClarification";
import type {
  CanonicalConversationRequest,
  CanonicalConversationResponse,
  CanonicalTruth,
  ConversationBuilderKey,
  ConversationOperation,
  ConversationPresentationPolicy,
  CurrentTurnAuthorityDecision,
  IntelligenceFact,
  OperationalObject,
  OperationalObjectType,
  PendingClarification,
  ResolvedConversationTurn,
  ResolvedOyiTurn,
  TruthState,
} from "../contracts/canonicalConversation";

export { isConversationContainerObject } from "../context/conversationTargetCandidates";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function cleanLabel(value: unknown, fallback: string) {
  const next = text(value);
  return next || fallback;
}

function normalizedCopy(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

type CanonicalBuiltAnswer = {
  supported: boolean;
  response: Record<string, unknown>;
  facts: IntelligenceFact[];
};

async function buildCanonicalAuthoritativeAnswer(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined, contract: IntelligenceRequestContract, object: OperationalObject | null, hydrationFacts: Record<string, unknown>): Promise<CanonicalBuiltAnswer> {
  const builderKey = selectConversationBuilder(contract, object);
  if (builderKey) {
    logger.info("conversation_builder_selected", {
      request_id: contract.conversation_request_id,
      thread_id: contract.thread_id,
      intent: contract.intent,
      operation: contract.operation_class,
      scope: contract.scope_mode,
      object_type: object?.object_type || contract.target.object_type,
      object_id: object?.canonical_id || contract.target.canonical_id,
      builder_key: builderKey,
    });
  } else {
    logger.info("conversation_builder_not_found", {
      request_id: contract.conversation_request_id,
      thread_id: contract.thread_id,
      intent: contract.intent,
      operation: contract.operation_class,
      scope: contract.scope_mode,
      object_type: object?.object_type || contract.target.object_type,
      object_id: object?.canonical_id || contract.target.canonical_id,
    });
  }
  logger.info("conversation_evidence_plan_created", {
    conversation_request_id: contract.conversation_request_id,
    required_sources: contract.evidence_requirements,
    permissions: object?.permissions || [],
    loaders: [contract.answer_builder, object?.source_module || input.module || "scope"],
  });
  logger.info("conversation_evidence_plan_built", {
    conversation_request_id: contract.conversation_request_id,
    answer_builder: contract.answer_builder,
    evidence_requirements: contract.evidence_requirements,
  });
  const baseFacts = object ? [factFromObject(object, hydrationFacts, input, oisContext)] : [];
  let facts = baseFacts;
  let answer = "";
  let displayMode: CanonicalConversationResponse["display_mode"] = "conversation";
  let execution: Record<string, unknown> = { status: "read_only", current_turn_execution: false };
  if (contract.scope_mode === "clarification" || contract.operation_class === "clarify") {
    answer = contract.ambiguity?.question || "I need one clarification before I can continue. No action was performed.";
    displayMode = "detail";
    const pendingClarification = pendingClarificationWorkflow(contract);
    if (pendingClarification) pendingClarification.original_user_message = input.message;
    execution = { status: "clarification_required", current_turn_execution: false, pending_clarification: pendingClarification };
    const shaped = {
      id: `oyi-runtime:${contract.conversation_request_id}`,
      thread_id: contract.thread_id || randomUUID(),
      intent: contract.intent,
      understood: "Clarification is required before Oyi can continue.",
      message: answer,
      reply: answer,
      display_mode: displayMode,
      confidence: 0.72,
      execution,
      sources: [],
      cards: [],
      suggested_actions: (contract.ambiguity?.candidates || []).map((candidate) => ({
        type: "clarification_choice",
        label: cleanLabel(candidate.label || candidate.title || candidate.name, "Choice"),
        value: text(candidate.device_id || candidate.id),
      })),
      confirmations: [],
      canonical_request_contract: contract,
      resolved_turn: resolvedConversationTurnFromContract(input, contract, object),
      presentation_policy: presentationPolicyForContract(contract),
      facts,
    };
    return { supported: true, response: shaped, facts };
  }
  if (contract.operation_class === "execute_mutation") {
    if (builderKey !== "device_control" || !object || !["device", "device_channel"].includes(object.object_type)) {
      return { supported: false, response: {}, facts };
    }
    const proposal = buildDeviceControlProposal({ contract, object });
    answer = proposal.answer;
    displayMode = "detail";
    execution = proposal.execution;
    const shaped = {
      id: `oyi-runtime:${contract.conversation_request_id}`,
      thread_id: contract.thread_id || randomUUID(),
      intent: contract.intent,
      understood: proposal.understood,
      message: answer,
      reply: answer,
      display_mode: displayMode,
      confidence: 0.82,
      execution,
      sources: [],
      cards: [],
      suggested_actions: [],
      confirmations: proposal.confirmations,
      canonical_request_contract: contract,
      resolved_turn: resolvedConversationTurnFromContract(input, contract, object),
      presentation_policy: presentationPolicyForContract(contract),
      facts,
    };
    return { supported: true, response: shaped, facts };
  }
  logger.info("conversation_read_only_execution_blocked", {
    operation_class: contract.operation_class,
    intent: contract.intent,
    target: contract.target,
  });
  if ((contract.intent === "scene_execution" || contract.intent === "automation_operation") && contract.operation_class === "compose") {
    const domain = contract.intent === "scene_execution" ? "scenes" : "automations";
    answer = buildSceneAutomationReviewAnswer(contract.intent, domain);
    displayMode = "detail";
    execution = { status: "review_required", current_turn_execution: false, domain, execution_boundary: "conversation_review_only" };
  } else if ((contract.intent === "message_operation" || contract.intent === "community_operation") && contract.operation_class === "compose") {
    const domain = contract.intent === "message_operation" ? "messages" : "community";
    answer = domain === "messages"
      ? "I can prepare a message draft, but I will not send it until you review and confirm it."
      : "I can prepare a community post or reply draft, but I will not publish it until you review and confirm it.";
    displayMode = "detail";
    execution = { status: "review_required", current_turn_execution: false, domain, community_thread_boundary: "oyi_conversation_thread_not_reused" };
  } else if (contract.intent === "domain_list" && ["scenes", "automations"].includes(domainForCurrentTurn(input.message) || "")) {
    const domain = domainForCurrentTurn(input.message) === "automations" ? "automations" : "scenes";
    const records = sceneAutomationRecordsFromContext(object, input);
    answer = buildSceneAutomationReadAnswer(records, domain);
    displayMode = "list";
    execution = { status: "read_only", current_turn_execution: false, domain, execution_boundary: "no_scene_or_automation_execution" };
  } else if (contract.intent === "domain_list" && ["community", "messages"].includes(domainForCurrentTurn(input.message) || "")) {
    const domain = domainForCurrentTurn(input.message) === "messages" ? "messages" : "community";
    const records = communityRecordsFromContext(object, input);
    answer = buildCommunityReadAnswer(records, { domain, broad: !contract.target.canonical_id });
    displayMode = "list";
    execution = { status: "read_only", current_turn_execution: false, domain, community_thread_boundary: "oyi_conversation_thread_not_reused" };
  } else if (contract.intent === "module_navigation" || contract.intent === "domain_list") {
    const semantic = semanticOperationAction(input.message, input.surface);
    if (!semantic) return { supported: false, response: {}, facts };
    if (!semantic.allowed) {
      answer = `${semantic.operation.destination.label} is not available on this surface. I did not navigate or perform any action.`;
      displayMode = "conversation";
      execution = { status: "denied", current_turn_execution: false, destination: semantic.operation.destination.key };
    } else {
      answer = contract.intent === "module_navigation"
        ? `Opening ${semantic.operation.destination.label}… Your conversation will remain available here.`
        : `Here is the ${semantic.operation.destination.label} workspace.`;
      displayMode = "conversation";
      execution = { status: "navigation_ready", current_turn_execution: false, destination: semantic.operation.destination.key, route: semantic.route, return_thread_id: contract.thread_id || null, requested_operation: contract.operation_class };
    }
  } else if (contract.intent === "recent_changes" || contract.intent === "activity_history") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildRecentChangesAnswer(facts, contract, presentationFactPredicates);
    displayMode = "list";
  } else if (contract.intent === "device_availability_inventory") {
    facts = dedupeFacts([...facts, ...await loadHomeDeviceInventoryFacts(input, oisContext)]);
    answer = buildDeviceAvailabilityInventoryAnswer(facts, contract, input.message);
    displayMode = "list";
  } else if (contract.intent === "home_operational_summary") {
    facts = dedupeFacts([...facts, ...await loadHomeDeviceInventoryFacts(input, oisContext), ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildHomeOperationalSummaryAnswer(facts, contract);
    displayMode = "report";
  } else if (contract.intent === "wallet_operation" && contract.answer_builder === "wallet_history") {
    facts = dedupeFacts([...facts, ...await loadWalletTransactionFacts(input, oisContext, contract)]);
    answer = buildWalletHistoryAnswer(facts);
    displayMode = "list";
  } else if (contract.intent === "wallet_operation" && contract.answer_builder === "utility_spending") {
    facts = dedupeFacts([...facts, ...await loadUtilitySpendingFacts(input, oisContext, contract)]);
    answer = buildUtilitySpendingAnswer(facts);
    displayMode = "list";
  } else if (contract.intent === "failure_history") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildDeviceFailureHistoryAnswer(facts, contract, { factAppliesToContract, isFailureFact });
    displayMode = "list";
  } else if (contract.intent === "command_outcome") {
    const command = await loadLatestCommandFact(input, oisContext, object);
    answer = buildCommandOutcomeAnswer(command);
    execution = { status: "read_only", referenced_execution: command, current_turn_execution: false };
  } else if (contract.intent === "report") {
    facts = await loadReportEvidence(input, oisContext, contract, object, facts, {
      loadRecentChangeFacts,
      dedupeFacts,
    });
    answer = buildReportAnswer(facts, object, contract, input.message);
    displayMode = "report";
  } else if (contract.intent === "health_check") {
    answer = buildDeviceHealthAnswer(object, hydrationFacts, { factFromObject });
  } else if (contract.intent === "diagnosis" || contract.intent === "investigation" || contract.intent === "explanation") {
    facts = dedupeFacts([...facts, ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildDeviceDiagnosisAnswer(object, hydrationFacts, facts, contract, { factFromObject, factAppliesToContract, isFailureFact });
    displayMode = "detail";
  } else if (contract.intent === "relationships") {
    answer = buildDeviceRelationshipsAnswer(object, input, hydrationFacts, contract, { listNames, arrayOfStrings });
    displayMode = "detail";
  } else if (contract.intent === "current_state" || contract.intent === "evidence") {
    answer = buildDeviceCurrentStateAnswer(object, hydrationFacts, contract, { factFromObject });
  } else if (contract.intent === "capability") {
    answer = buildCapabilityAnswer(object, input);
  } else if (contract.intent === "recommendation") {
    facts = dedupeFacts([...facts, ...await loadHomeDeviceInventoryFacts(input, oisContext), ...await loadRecentChangeFacts(input, oisContext, contract, object)]);
    answer = buildGenericRecommendationAnswer(object, facts);
    displayMode = "detail";
  } else {
    return { supported: false, response: {}, facts };
  }
  const deduped = dedupeFacts(facts);
  for (const fact of deduped.slice(0, 12)) {
    logger.info("conversation_fact_loaded", {
      fact_id: fact.fact_id,
      truth_state: fact.truth_state,
      freshness: fact.freshness,
    });
  }
  logger.info("conversation_answer_builder_selected", {
    builder: contract.answer_builder,
    builder_key: builderKey,
    reason: "canonical_supported_intent",
  });
  logger.info("conversation_execution_correlation_checked", {
    conversation_request_id: contract.conversation_request_id,
    execution_id: text(recordOf(execution.referenced_execution).id) || null,
    matched: false,
    reason: ["read", "report", "recommend", "navigate", "list"].includes(contract.operation_class) ? "read_only_current_turn" : "no_execution",
  });
  const safeAnswer = enforceResidentAnswerQuality(
    naturalizeUserCopy(stripInternalLanguage(answer)).replace(/^Done[.,]?\s*/i, ""),
    object
      ? `I checked ${object.label}, but the available evidence is not clean enough to summarize safely. I did not widen to other devices or perform any action.`
      : "I checked the authorised evidence, but it is not clean enough to summarize safely. I did not perform any action.",
  );
  const tableBlock = tableBlockForContract(contract, deduped, presentationFactPredicates);
  const cards = tableBlock ? [tableBlock] : [];
  const resolvedTurn = resolvedConversationTurnFromContract(input, contract, object);
  const presentationPolicy = presentationPolicyForContract(contract);
  const suppressAwareness = Boolean(presentationPolicy.suppress_equivalent_awareness) && presentationPolicy.primary === "table";
  const suppressSources = presentationPolicy.suppress_context_chips || presentationPolicy.primary === "table";
  const awarenessSummary = contract.intent === "recent_changes" || contract.intent === "activity_history"
    ? "Recent meaningful activity was reviewed."
    : contract.intent === "device_availability_inventory"
      ? "Home device availability was checked."
      : contract.intent === "home_operational_summary"
        ? "Home status was reviewed."
        : safeAnswer.split("\n")[0];
  const awareness = !suppressAwareness && normalizedCopy(awarenessSummary) && normalizedCopy(awarenessSummary) !== normalizedCopy(safeAnswer)
    ? {
      headline: contract.intent === "recent_changes" ? "Recent changes reviewed" : contract.intent === "report" ? "Report ready" : "Oyi answer grounded",
      summary: awarenessSummary,
      severity: "info",
    }
    : undefined;
  return {
    supported: true,
    facts: deduped,
    response: {
      id: `oyi-runtime:${contract.conversation_request_id}`,
      thread_id: contract.thread_id || randomUUID(),
      intent: contract.intent,
      understood: contract.target.label ? `Answering ${contract.intent.replace(/_/g, " ")} for ${contract.target.label}.` : `Answering ${contract.intent.replace(/_/g, " ")} for the current ${contract.scope_mode.replace(/_/g, " ")}.`,
      message: safeAnswer,
      reply: safeAnswer,
      display_mode: displayMode,
      confidence: deduped.length ? 0.88 : 0.72,
      execution,
      sources: suppressSources ? [] : deduped.slice(0, 6).map((fact) => ({ id: fact.source_id || fact.fact_id, type: fact.source_type, label: fact.statement, truth_state: fact.truth_state })),
      cards,
      suggested_actions: contract.intent === "module_navigation" || contract.intent === "domain_list"
        ? (semanticOperationAction(input.message, input.surface)?.allowed ? [semanticOperationAction(input.message, input.surface)?.action].filter(Boolean).map((action) => ({ ...action, return_thread_id: contract.thread_id || null, requested_operation: contract.operation_class, auto_navigation: contract.operation_class === "navigate" })) as Array<Record<string, unknown>> : [])
        : contract.intent === "device_availability_inventory"
          ? [{ type: "navigation", operation_class: "navigate", label: "Open Devices", route: "/devices", destination: { key: "devices.module", parameters: {} } }]
          : object ? contextualObjectActions(object, input).filter((action) => recordOf(action).risk !== "control").slice(0, 4) : [],
      ...(awareness ? { awareness } : {}),
      canonical_request_contract: contract,
      resolved_turn: resolvedTurn,
      presentation_policy: presentationPolicy,
      facts: deduped,
    },
  };
}

async function persistCanonicalAuthoritativeMessages(actor: AuthUser | null, input: CanonicalConversationRequest, response: Record<string, unknown>, truth: CanonicalTruth, object: OperationalObject | null, contract: IntelligenceRequestContract) {
  return persistCanonicalConversationTurn({
    actor,
    oisContext: null,
    request: input,
    response,
    truth,
    object,
    contract,
    builderKey: selectConversationBuilder(contract, object),
  });
}


function compatibilityInputFromCanonical(input: CanonicalConversationRequest, operationalObject: OperationalObject | null): OyiChatInput {
  const objectMetadata = recordOf(operationalObject?.metadata);
  return {
    surface: input.surface,
    estate_id: input.estate_id || operationalObject?.estate_id || null,
    home_id: input.home_id || operationalObject?.home_id || null,
    module: input.module || operationalObject?.source_module || null,
    role: input.role || null,
    message: input.message,
    thread_id: input.thread_id || null,
    context: input.context as OisContext | null,
    device_id: input.device_id || (operationalObject?.object_type === "device" ? operationalObject.canonical_id : operationalObject?.object_type === "device_channel" ? operationalObject.parent_id : null),
    device_name: input.device_name || (operationalObject?.object_type === "device" || operationalObject?.object_type === "device_channel" ? operationalObject.label : null),
    room_id: input.room_id || operationalObject?.room_id || null,
    room_name: input.room_name || null,
    control_profile: input.control_profile || null,
    primary_state: input.primary_state || operationalObject?.current_state || null,
    health_status: input.health_status || operationalObject?.health || null,
    supported_controls: input.supported_controls || operationalObject?.capabilities || null,
    channel_definitions: input.channel_definitions || (Array.isArray(objectMetadata.channel_definitions) ? objectMetadata.channel_definitions as Array<Record<string, unknown>> : null),
    memory_summary: input.memory_summary || null,
    relationships: input.relationships || (operationalObject?.relationships as Record<string, unknown>) || null,
    predictive_findings: input.predictive_findings || null,
    recent_executions: input.recent_executions || null,
    active_scenes: input.active_scenes || null,
    active_automations: input.active_automations || null,
    conversation_context: {
      ...(input.conversation_context || {}),
      canonical_operational_object: operationalObject,
      canonical_truth_requested: true,
    },
    persist: false,
  };
}

export async function runCanonicalConversation(actor: AuthUser | null, oisContext: OisContext | null | undefined, input: CanonicalConversationRequest): Promise<CanonicalConversationResponse> {
  input = sanitizeConversationInputTargets(input);
  const normalizedTurn = normalizeUserTurn(input.message);
  logger.info("oyi_turn_normalized", {
    request_id: text(recordOf(input.context).request_id) || null,
    thread_id: input.thread_id || null,
    domain: normalizedTurn.domain,
    operation: normalizedTurn.operation,
    correction_count: normalizedTurn.corrections.length,
    entity_count: normalizedTurn.entities.length,
    reference_count: normalizedTurn.references.length,
    mutation_intent: normalizedTurn.mutation_intent,
  });
  const threadContext = await loadOyiConversationContext(actor, {
    surface: input.surface,
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    thread_id: input.thread_id || null,
    message: input.message,
  } as OyiChatInput);
  const pendingClarification = pendingClarificationFromThread(threadContext);
  if (pendingClarification) {
    if (userCancelledClarification(input.message)) {
      const answer = "Cancelled. No command was sent.";
      const contract = resolveIntentContract(input, null, { objectType: null, objectId: null, objectName: null, confidence: 0.8 });
      const shaped = {
        id: `oyi-runtime:${contract.conversation_request_id}`,
        thread_id: text(input.thread_id) || randomUUID(),
        intent: "clarification_cancelled",
        understood: "Pending clarification cancelled.",
        message: answer,
        reply: answer,
        display_mode: "conversation" as const,
        confidence: 0.8,
        execution: { status: "cancelled", current_turn_execution: false, pending_clarification: null },
        cards: [],
        sources: [],
        suggested_actions: [],
        confirmations: [],
        resolved_turn: resolvedConversationTurnFromContract(input, contract, null),
        presentation_policy: presentationPolicyForContract(contract),
        facts: [],
      };
      const truth = canonicalTruthFor(shaped, null);
      const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, shaped, truth, null, contract);
      return {
        id: shaped.id,
        thread_id: persistedThreadId || null,
        intent: shaped.intent,
        understood: shaped.understood,
        summary: answer,
        answer,
        reply: answer,
        message: answer,
        display_mode: "conversation",
        truth,
        operational_object: null,
        context: { surface: input.surface, estate_id: input.estate_id || oisContext?.estate_id || null, home_id: input.home_id || oisContext?.home_id || null, module: input.module || oisContext?.module || null, context_source: "thread_state", warnings: [] },
        resolved_turn: recordOf(shaped.resolved_turn) as ResolvedConversationTurn,
        execution: shaped.execution,
        cards: [],
        sources: [],
        suggested_actions: [],
        presentation_policy: recordOf(shaped.presentation_policy) as ConversationPresentationPolicy,
        confirmations: [],
        warnings: persistedThreadId ? [] : ["This answer was not saved to conversation history."],
        persistence_saved: Boolean(persistedThreadId),
        source: "oyi_canonical_runtime",
        safe_mode: true,
        approvalRequired: false,
        requiresConfirmation: false,
      };
    }
    const selectedCandidate = matchPendingClarificationCandidate(pendingClarification, input.message);
    if (selectedCandidate) {
      const contract = resolveIntentContract(input, null, { objectType: "device", objectId: text(selectedCandidate.device_id || selectedCandidate.id), objectName: text(selectedCandidate.label || selectedCandidate.title || selectedCandidate.name), confidence: 0.82 });
      const shaped = buildClarificationContinuationResponse(input, pendingClarification, selectedCandidate);
      const truth = canonicalTruthFor(shaped, null);
      const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, shaped, truth, null, contract);
      return {
        id: shaped.id,
        thread_id: persistedThreadId || null,
        intent: shaped.intent,
        understood: shaped.understood,
        summary: shaped.message,
        answer: shaped.message,
        reply: shaped.reply,
        message: shaped.message,
        display_mode: "detail",
        truth,
        operational_object: null,
        context: { surface: input.surface, estate_id: input.estate_id || oisContext?.estate_id || null, home_id: input.home_id || oisContext?.home_id || null, module: input.module || oisContext?.module || null, context_source: "thread_state", warnings: [] },
        resolved_turn: recordOf(shaped.resolved_turn) as ResolvedConversationTurn,
        execution: shaped.execution,
        cards: shaped.cards,
        sources: shaped.sources,
        suggested_actions: shaped.suggested_actions,
        presentation_policy: recordOf(shaped.presentation_policy) as ConversationPresentationPolicy,
        confirmations: shaped.confirmations,
        warnings: persistedThreadId ? [] : ["This answer was not saved to conversation history."],
        persistence_saved: Boolean(persistedThreadId),
        source: "oyi_canonical_runtime",
        safe_mode: true,
        approvalRequired: Boolean(shaped.confirmations.length),
        requiresConfirmation: Boolean(shaped.confirmations.length),
      };
    }
  }
  const explicitCandidate = explicitObjectCandidate(input);
  const threadCandidate = threadObjectCandidate(threadContext);
  const activeContextRecord = recordOf(input.active_intelligence_context || recordOf(input.context).active_intelligence_context || recordOf(recordOf(input.context).runtime_context).active_context || recordOf(input.conversation_context).active_context);
  const selectedSubobjectRecord = recordOf(activeContextRecord.selected_subobject || recordOf(input.conversation_context).selected_subobject);
  const scopeHint = text(input.scope_mode_hint || recordOf(input.conversation_context).scope_mode_hint || recordOf(input.context).scope_mode_hint);
  const broadReadOnlyDeviceIntent = isExplicitBroadHomeReadIntent(input.message || "", scopeHint);
  const initialRoomPhrase = !broadReadOnlyDeviceIntent ? roomPhraseFromMessage(input.message || "") : "";
  const initialSemanticOperation = interpretSemanticOperation(input.message || "");
  const inheritedCandidate = explicitCandidate || threadCandidate;
  const currentTurnAuthority = resolveCurrentTurnAuthorityDecision(input, inheritedCandidate, {
    roomPhrase: initialRoomPhrase,
    broadReadOnlyDeviceIntent,
    semanticOperation: initialSemanticOperation,
  });
  const inheritedExactTargetAllowed = currentTurnAuthority.mayUseInheritedExactTarget && canInheritedExactTargetSatisfyCurrentTurn(input, inheritedCandidate, {
    roomPhrase: initialRoomPhrase,
    broadReadOnlyDeviceIntent,
    semanticOperation: initialSemanticOperation,
  });
  const requestedChannel = requestedChannelCode(input.message || "");
  const shouldRebindRequestedChannel = Boolean(requestedChannel && isControlRequest(input.message || "") && !broadReadOnlyDeviceIntent);
  if (Object.keys(activeContextRecord).length) {
    logger.info("conversation_page_launch_context_received", {
      request_id: text(recordOf(input.context).request_id) || null,
      thread_id: input.thread_id || null,
      context_id: text(activeContextRecord.context_id) || null,
      context_version: Number(activeContextRecord.context_version) || null,
      target_type: text(recordOf(activeContextRecord.primary_object).object_type || recordOf(input.operational_object).object_type) || null,
      target_id: text(recordOf(activeContextRecord.primary_object).canonical_id || recordOf(input.operational_object).canonical_id) || null,
    });
  }
  if (threadCandidate) {
    logger.info("conversation_thread_memory_restored", {
      thread_id: input.thread_id || null,
      target_type: threadCandidate.object_type,
      target_id: threadCandidate.canonical_id,
      target_source: threadCandidate.source,
    });
  }
  logger.info("conversation_current_turn_authority_resolved", {
    request_id: text(recordOf(input.context).request_id) || null,
    thread_id: input.thread_id || null,
    operation: currentTurnAuthority.operation,
    domain: currentTurnAuthority.domain,
    scope: currentTurnAuthority.scope,
    explicit_room_phrase: currentTurnAuthority.explicitRoomPhrase,
    explicit_object_phrase: currentTurnAuthority.explicitObjectPhrase,
    temporal_scope: currentTurnAuthority.temporalScope,
    inherited_object_type: inheritedCandidate?.object_type || null,
    inherited_object_id: inheritedCandidate?.canonical_id || null,
    may_use_inherited_exact_target: currentTurnAuthority.mayUseInheritedExactTarget,
    rejection_reason: currentTurnAuthority.rejectionReason,
  });
  if (broadReadOnlyDeviceIntent) {
    logger.info("read_only_command_execution_blocked", {
      intent: isReadOnlyBroadDeviceIntent(input.message || "") ? "show_offline_devices" : "broad_home_read",
      target: "home_scope",
      attempted_operation: "device_command_context_reuse",
    });
    logger.info("conversation_inherited_target_cleared", {
      reason: "explicit_broad_read_turn",
      previous_target_id: text(recordOf(input.operational_object).canonical_id || input.target?.target_id || selectedSubobjectRecord.canonical_id) || null,
      scope_hint: scopeHint || null,
    });
  }
  if (inheritedCandidate && !inheritedExactTargetAllowed) {
    logger.info("conversation_inherited_target_rejected", {
      reason: broadReadOnlyDeviceIntent ? "explicit_broad_scope" : initialRoomPhrase ? "explicit_room_scope" : initialSemanticOperation ? "explicit_domain_or_navigation" : currentTurnExplicitlyGlobal(input.message || "") ? "global_turn" : "not_referential",
      inherited_target_type: inheritedCandidate.object_type,
      inherited_target_id: inheritedCandidate.canonical_id,
      scope_hint: scopeHint || null,
    });
  } else if (inheritedCandidate && inheritedExactTargetAllowed) {
    logger.info("conversation_inherited_target_accepted", {
      reason: currentTurnReferencesInheritedTarget(input.message || "") ? "referential_turn" : "exact_scope_hint",
      inherited_target_type: inheritedCandidate.object_type,
      inherited_target_id: inheritedCandidate.canonical_id,
      scope_hint: scopeHint || null,
    });
  }
  let targetResolution = resolveConversationTarget({
    query: input.message,
    explicitTarget: inheritedExactTargetAllowed ? input.target as any : null,
    selectedObject: inheritedExactTargetAllowed ? (Object.keys(selectedSubobjectRecord).length ? selectedSubobjectRecord as any : input.operational_object as any) : null,
    pageObject: inheritedExactTargetAllowed && explicitCandidate ? {
      object_type: explicitCandidate.object_type,
      object_id: explicitCandidate.canonical_id,
      object_name: explicitCandidate.label || null,
    } : null,
    threadTarget: inheritedExactTargetAllowed && threadCandidate ? {
      object_type: threadCandidate.object_type,
      object_id: threadCandidate.canonical_id,
      object_name: threadCandidate.label,
    } : null,
    context: {
      surface: input.surface,
      module: input.module || oisContext?.module || "other",
      route: text(recordOf(input.context).route),
      estate_id: input.estate_id || oisContext?.estate_id || null,
      building_id: text(recordOf(input.context).building_id || recordOf(input.context).buildingId) || null,
      home_id: input.home_id || oisContext?.home_id || null,
      room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
      object_type: inheritedExactTargetAllowed ? explicitCandidate?.object_type || null : null,
      object_id: inheritedExactTargetAllowed ? explicitCandidate?.canonical_id || null : null,
      object_name: inheritedExactTargetAllowed ? explicitCandidate?.label || null : null,
      active_intelligence_context: activeContextRecord,
    } as any,
  });
  if (shouldRebindRequestedChannel && requestedChannel && targetResolution.objectType === "device_channel" && targetResolution.objectId) {
    const parsed = parseDeviceChannelIdentity(targetResolution.objectId);
    if (parsed.parent_id && parsed.channel_code !== requestedChannel) {
      targetResolution = {
        ...targetResolution,
        objectId: `${parsed.parent_id}:${requestedChannel}`,
        objectName: text(targetResolution.objectName).replace(/Channel\s+[123]/i, requestedChannel.replace(/^switch_/i, "Channel ")) || targetResolution.objectName,
      } as any;
      logger.info("conversation_target_scope_normalized", {
        reason: "explicit_channel_requested",
        requested_channel: requestedChannel,
        previous_channel: parsed.channel_code,
        resolved_target_id: targetResolution.objectId,
      });
    }
  }
  const namedControlPhrase = currentTurnAllowsDeviceResolution(input.message || "") ? namedDevicePhraseFromControlMessage(input.message || "", { isControlRequest }) : null;
  if (namedControlPhrase && !broadReadOnlyDeviceIntent) {
    const namedResolution = await resolveNamedDeviceForRead(actor, oisContext, input, namedControlPhrase);
    if (namedResolution.status === "resolved") {
      targetResolution = {
        ...targetResolution,
        objectType: namedResolution.channel_code ? "device_channel" : "device",
        objectId: namedResolution.channel_code ? `${namedResolution.device_id}:${namedResolution.channel_code}` : namedResolution.device_id,
        objectName: namedResolution.label,
        source: "resolved_named_reference",
        confidence: namedResolution.confidence,
      } as any;
      logger.info("conversation_target_bound", {
        request_id: text(recordOf(input.context).request_id) || null,
        target_type: targetResolution.objectType,
        target_id: targetResolution.objectId,
        target_source: "current_turn_named_device",
        phrase: namedControlPhrase,
        confidence: namedResolution.confidence,
      });
    } else if (namedResolution.status === "ambiguous") {
      const ambiguousTargetResolution: any = {
        ...targetResolution,
        objectType: null,
        objectId: null,
        objectName: namedControlPhrase,
        source: "ambiguous",
        confidence: 0.52,
        ambiguous: true,
        clarificationQuestion: `Which ${namedControlPhrase} do you mean?`,
        candidates: namedResolution.candidates,
      };
      targetResolution = ambiguousTargetResolution;
      logger.info("conversation_target_bound", {
        request_id: text(recordOf(input.context).request_id) || null,
        target_source: "current_turn_named_device_ambiguous",
        phrase: namedControlPhrase,
        candidates: namedResolution.candidates.length,
      });
    } else {
      const missingTargetResolution: any = {
        ...targetResolution,
        objectType: null,
        objectId: null,
        objectName: namedControlPhrase,
        source: "resolved_named_reference",
        confidence: 0.5,
        notFound: true,
      };
      targetResolution = missingTargetResolution;
      logger.info("conversation_target_bound", {
        request_id: text(recordOf(input.context).request_id) || null,
        target_source: "current_turn_named_device_not_found",
        phrase: namedControlPhrase,
      });
    }
  }
  const roomPhrase = initialRoomPhrase;
  if (roomPhrase && !namedControlPhrase) {
    const roomResolution = await resolveRoomForRead(actor, oisContext, input, roomPhrase);
    if (roomResolution.status === "resolved") {
      targetResolution = {
        ...targetResolution,
        objectType: "room",
        objectId: roomResolution.room_id,
        objectName: roomResolution.label,
        source: "current_turn_room_reference",
        confidence: roomResolution.confidence,
      } as any;
      input = { ...input, room_id: roomResolution.room_id, room_name: roomResolution.label };
      logger.info("conversation_target_bound", {
        request_id: text(recordOf(input.context).request_id) || null,
        target_type: "room",
        target_id: roomResolution.room_id,
        target_source: "current_turn_room_reference",
        phrase: roomPhrase,
        confidence: roomResolution.confidence,
      });
    } else if (roomResolution.status === "ambiguous") {
      targetResolution = {
        ...targetResolution,
        objectType: null,
        objectId: null,
        objectName: roomPhrase,
        source: "ambiguous",
        confidence: 0.52,
        ambiguous: true,
        clarificationQuestion: `Which ${roomPhrase} do you mean?`,
        candidates: roomResolution.candidates.map((candidate) => ({ type: "room", id: candidate.room_id, label: candidate.label })),
      } as any;
    }
  }
  if ((broadReadOnlyDeviceIntent || currentTurnAuthority.scope === "home_scope") && (input.home_id || oisContext?.home_id)) {
    targetResolution = {
      ...targetResolution,
      objectType: "home",
      objectId: input.home_id || oisContext?.home_id || null,
      objectName: text(recordOf(input.context).home_name || recordOf(input.context).homeName) || "Home",
      source: "home_scope",
      confidence: Math.max(Number(targetResolution.confidence) || 0, 0.9),
    };
    logger.info("conversation_explicit_scope_applied", {
      request_id: text(recordOf(input.context).request_id) || null,
      scope: "home_scope",
      target_id: targetResolution.objectId,
      source: "current_turn_explicit_scope",
    });
  }
  const visibleStateRecord = recordOf(activeContextRecord.visible_state || recordOf(input.conversation_context).visible_state || recordOf(recordOf(input.operational_object).metadata).visible_state);
  logger.info("conversation_target_resolved", {
    request_id: text(recordOf(input.context).request_id) || null,
    context_id: text(activeContextRecord.context_id) || null,
    context_version: Number(activeContextRecord.context_version) || null,
    object_type: targetResolution.objectType,
    canonical_id: targetResolution.objectId,
    visible_target_id: text(recordOf(activeContextRecord.visible_state).object_id || recordOf(recordOf(activeContextRecord.visible_state).summary).object_id) || null,
    submitted_target_id: text(recordOf(input.operational_object).canonical_id || input.target?.target_id) || null,
    resolved_target_id: targetResolution.objectId || null,
    target_consistency: (text(recordOf(input.operational_object).canonical_id || input.target?.target_id) && text(recordOf(input.operational_object).canonical_id || input.target?.target_id) !== text(targetResolution.objectId))
      ? "mismatch"
      : "matched",
    target_override_reason: targetResolution.source,
    target_source: targetResolution.source,
    target_confidence: targetResolution.confidence,
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
  });
  let hydration = await hydrateCanonicalTarget({
    actor,
    oisContext,
    target: targetResolution,
    activeContext: activeContextRecord,
    visibleState: Object.keys(visibleStateRecord).length ? visibleStateRecord : null,
  });
  let resolved: ResolvedOperationalObject = {
    object: hydration.object,
    source: broadReadOnlyDeviceIntent ? "home_scope" : explicitCandidate?.source || threadCandidate?.source || "page_selection",
    warnings: hydration.status === "hydrated" ? [] : hydration.reason ? [hydration.reason] : [],
  };
  if (!inheritedExactTargetAllowed && resolved.object && ["device", "device_channel"].includes(resolved.object.object_type) && !["resolved_named_reference", "current_turn_room_reference", "home_scope"].includes(text(targetResolution.source))) {
    resolved = { object: null, source: "home_scope", warnings: [] };
  }
  if (!resolved.object && inheritedExactTargetAllowed && targetResolution.objectType !== "home" && targetResolution.source !== "explicit_canonical_target" && targetResolution.source !== "selected_subobject" && targetResolution.source !== "active_page_object") {
    const preferredCandidate = inheritedCandidate;
    resolved = await hydrateOperationalObjectCandidate({
      actor,
      oisContext,
      candidate: preferredCandidate,
      activeContext: activeContextRecord,
      visibleState: Object.keys(visibleStateRecord).length ? visibleStateRecord : null,
      surface: input.surface,
    });
  }
  const requestContract = resolveIntentContract(input, resolved.object, targetResolution as any);
  const turnInterpretation = turnInterpretationFromContract(input, requestContract, targetResolution as any, resolved.source);
  const resolvedOyiTurn = resolvedOyiTurnFromContract(input, normalizedTurn, requestContract, resolved.object, { targetSource: targetResolution.source || resolved.source });
  const activeWorkflow = workflowForResolvedTurn(input, normalizedTurn, requestContract, resolved.object, resolvedOyiTurn);
  const domainCapability = getDomainCapability((resolvedOyiTurn.domain || normalizedTurn.domain || "global") as OyiDomain);
  const builderForTurn = selectConversationBuilder(requestContract, resolved.object);
  logger.info("oyi_turn_resolved", {
    request_id: resolvedOyiTurn.request_id,
    thread_id: resolvedOyiTurn.thread_id,
    domain: resolvedOyiTurn.domain,
    operation: resolvedOyiTurn.operation,
    capability_key: resolvedOyiTurn.capability_key,
    target_type: resolvedOyiTurn.target?.object_type || null,
    target_id: resolvedOyiTurn.target?.canonical_id || null,
    target_source: resolvedOyiTurn.target_source,
  });
  logger.info("oyi_target_authority_decided", {
    request_id: resolvedOyiTurn.request_id,
    thread_id: resolvedOyiTurn.thread_id,
    domain: resolvedOyiTurn.domain,
    operation: resolvedOyiTurn.operation,
    authority_result: resolvedOyiTurn.authority.allowed ? "allowed" : "denied",
    tier: resolvedOyiTurn.authority.tier,
    approval_required: resolvedOyiTurn.authority.approval_required,
    secure_review_required: resolvedOyiTurn.authority.secure_review_required,
  });
  if (domainCapability) {
    logger.info("oyi_capability_selected", {
      request_id: resolvedOyiTurn.request_id,
      thread_id: resolvedOyiTurn.thread_id,
      domain: domainCapability.domain,
      operation: resolvedOyiTurn.operation,
      capability_key: resolvedOyiTurn.capability_key,
      builder_key: builderForTurn,
    });
  } else {
    logger.info("oyi_capability_missing", {
      request_id: resolvedOyiTurn.request_id,
      thread_id: resolvedOyiTurn.thread_id,
      domain: resolvedOyiTurn.domain,
      operation: resolvedOyiTurn.operation,
      capability_key: resolvedOyiTurn.capability_key,
    });
  }
  logger.info("oyi_workflow_created", {
    request_id: activeWorkflow.request_id,
    thread_id: activeWorkflow.thread_id,
    workflow_id: activeWorkflow.workflow_id,
    domain: activeWorkflow.domain,
    operation: activeWorkflow.operation,
    status: activeWorkflow.status,
    target_type: activeWorkflow.target?.object_type || null,
  });
  logger.info("oyi_presentation_policy_applied", {
    request_id: resolvedOyiTurn.request_id,
    thread_id: resolvedOyiTurn.thread_id,
    domain: resolvedOyiTurn.domain,
    operation: resolvedOyiTurn.operation,
    primary: resolvedOyiTurn.presentation_policy.primary,
  });
  logger.info("conversation_turn_interpreted", {
    request_id: requestContract.conversation_request_id,
    correlation_id: text(recordOf(input.context).correlation_id) || null,
    runtime_id: text(recordOf(input.context).runtime_id) || null,
    thread_id: requestContract.thread_id,
    actor_id: actor?.id || null,
    surface: input.surface,
    intent: turnInterpretation.intent,
    operation_class: turnInterpretation.operationClass,
    requested_scope: turnInterpretation.requestedScope,
    target_type: requestContract.target.object_type,
    target_id: requestContract.target.canonical_id,
    target_source: targetResolution.source,
    confidence: turnInterpretation.confidence,
  });
  if (turnInterpretation.pronounReference.used) {
    logger.info("conversation_pronoun_resolved", {
      request_id: requestContract.conversation_request_id,
      thread_id: requestContract.thread_id,
      phrase: turnInterpretation.pronounReference.phrase,
      resolved_from: turnInterpretation.pronounReference.resolvedFrom,
      target_id: requestContract.target.canonical_id,
    });
  }
  if (turnInterpretation.requiresLiveEvidence) {
    logger.info("conversation_live_evidence_required", {
      request_id: requestContract.conversation_request_id,
      intent: requestContract.intent,
      target_id: requestContract.target.canonical_id,
      scope: requestContract.scope_mode,
    });
  }
  if (!resolved.object) {
    const scopeObject = constructBroadScopeObject(input, oisContext || null, requestContract);
    if (scopeObject) {
      resolved = {
        object: scopeObject,
        source: "home_scope",
        warnings: hydration.status === "hydrated" ? [] : hydration.reason ? [hydration.reason] : [],
      };
      hydration = {
        ...hydration,
        object: scopeObject,
        status: "hydrated",
        source: "canonical_backend",
        truth_state: "observed",
        facts: {},
      } as any;
      logger.info("conversation_target_bound", {
        request_id: requestContract.conversation_request_id,
        target_type: scopeObject.object_type,
        target_id: scopeObject.canonical_id,
        target_source: "current_turn_explicit_scope",
        confidence: requestContract.confidence,
      });
    }
  }
  const moduleFacts = buildModuleFacts({
    surface: input.surface,
    module: input.module || oisContext?.module || "other",
    route: text(recordOf(input.context).route),
    estate_id: input.estate_id || oisContext?.estate_id || null,
    building_id: text(recordOf(input.context).building_id || recordOf(input.context).buildingId) || null,
    home_id: input.home_id || oisContext?.home_id || null,
    room_id: input.room_id || text(recordOf(input.context).room_id || recordOf(input.context).roomId) || null,
    object_type: resolved.object?.object_type || null,
    object_id: resolved.object?.canonical_id || null,
    object_name: resolved.object?.label || null,
    privacy_class: resolved.object?.home_id ? "home_private" : "building_operational",
  } as any, {
    capabilities: resolved.object?.capabilities || [],
    current_state: resolved.object?.current_state || null,
    health: resolved.object?.health || null,
    relationships: resolved.object?.relationships || {},
    hydration_status: hydration.status,
    hydration_source: hydration.source,
    hydration_truth_state: hydration.truth_state,
    hydration_facts: hydration.facts,
    hydration_evidence: hydration.evidence,
  });
  logger.info("conversation_request_contract_resolved", {
    request_id: requestContract.conversation_request_id,
    thread_id: requestContract.thread_id,
    submitted_target: {
      operational_object_id: text(recordOf(input.operational_object).canonical_id) || null,
      target_id: input.target?.target_id || null,
    },
    resolved_target: requestContract.target,
    operation_class: requestContract.operation_class,
    intent: requestContract.intent,
    scope: requestContract.scope_mode,
    target: requestContract.target,
    temporal_scope: requestContract.temporal_scope,
    builder: requestContract.answer_builder,
  });
  const refreshedHydration = await requestBoundedLiveEvidence({
    contract: requestContract,
    object: resolved.object,
    conversationTarget: targetResolution,
    actor,
    oisContext,
    activeContext: activeContextRecord,
    visibleState: Object.keys(visibleStateRecord).length ? visibleStateRecord : null,
  });
  if (refreshedHydration?.status === "hydrated") {
    hydration = refreshedHydration;
    resolved = {
      object: hydration.object,
      source: "page_selection",
      warnings: [],
    };
  }
  const exactTargetRequested = !Boolean((targetResolution as any).ambiguous) && !Boolean((targetResolution as any).notFound) && Boolean(inheritedExactTargetAllowed || ["explicit_canonical_target", "selected_subobject", "active_page_object", "resolved_named_reference"].includes(targetResolution.source));
  if (exactTargetRequested && !resolved.object) {
    const label = cleanLabel(explicitCandidate?.label || targetResolution.objectName, "the selected item");
    const answer = `I know you are asking about ${label}, but I could not retrieve its current information in this scope.`;
    const shaped = {
      id: `oyi-runtime:${randomUUID()}`,
      thread_id: text(input.thread_id) || randomUUID(),
      intent: "target_unavailable",
      understood: `Inspect ${label}`,
      message: answer,
      reply: answer,
      display_mode: "detail",
      confidence: 0.86,
      awareness: {
        headline: `${label} is unavailable to Oyi Core right now`,
        summary: "The active context was preserved, and Oyi did not widen to unrelated records.",
        severity: "attention",
      },
    };
    const truth = canonicalTruthFor(shaped, null);
    const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, shaped, truth, null, requestContract);
    const responseWarnings = [
      ...resolved.warnings,
      ...(!persistedThreadId ? ["This answer was not saved to conversation history."] : []),
    ];
    return {
      id: shaped.id,
      thread_id: persistedThreadId || null,
      intent: shaped.intent,
      understood: shaped.understood,
      summary: shaped.message,
      answer,
      reply: answer,
      message: answer,
      display_mode: "detail",
      truth,
      operational_object: null,
      context: {
        surface: input.surface,
        estate_id: input.estate_id || oisContext?.estate_id || null,
        home_id: input.home_id || oisContext?.home_id || null,
        module: input.module || oisContext?.module || null,
        context_source: resolved.source,
        warnings: responseWarnings,
        target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationReason: hydration.reason, scopeWidened: false },
        module_facts: moduleFacts,
      },
      resolved_turn: resolvedConversationTurnFromContract(input, requestContract, null),
      execution: {
        normalized_turn: normalizedTurn,
        resolved_oyi_turn: resolvedOyiTurn,
        workflow: activeWorkflow,
      },
      cards: [],
      sources: [],
      suggested_actions: [],
      awareness: shaped.awareness,
      presentation_policy: presentationPolicyForContract(requestContract),
      confirmations: [],
      warnings: responseWarnings,
      persistence_saved: Boolean(persistedThreadId),
      source: "oyi_canonical_runtime",
      safe_mode: true,
      approvalRequired: false,
      requiresConfirmation: false,
    };
  }
  const canonicalBuilt = await buildCanonicalAuthoritativeAnswer(input, oisContext || null, requestContract, resolved.object, hydration.facts || {});
  if (canonicalBuilt.supported) {
    const shapedCanonical = canonicalBuilt.response;
    const truth = canonicalTruthFor(shapedCanonical, resolved.object);
    const threadId = text(shapedCanonical.thread_id) || text(input.thread_id) || randomUUID();
    const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, { ...shapedCanonical, thread_id: threadId }, truth, resolved.object, requestContract);
    const responseWarnings = [
      ...resolved.warnings,
      ...(targetResolution.ambiguous && targetResolution.clarificationQuestion ? [targetResolution.clarificationQuestion] : []),
      ...(threadContext.warning ? [threadContext.warning] : []),
      ...(!persistedThreadId ? ["This answer was not saved to conversation history."] : []),
    ];
    logger.info("conversation_final_answer_selected", {
      conversation_request_id: requestContract.conversation_request_id,
      thread_id: persistedThreadId || null,
      operation_class: requestContract.operation_class,
      intent: requestContract.intent,
      scope_mode: requestContract.scope_mode,
      answer_builder: requestContract.answer_builder,
      evidence_fact_count: canonicalBuilt.facts.length,
      evidence_freshness_summary: canonicalBuilt.facts.map((fact) => fact.freshness).slice(0, 6),
      truth_state_summary: truth.truth_state,
      compatibility_invoked: false,
      compatibility_reason: null,
      final_answer_authority: "canonical",
      persisted_message_id: text(shapedCanonical.id).replace(/^oyi-runtime:/, "") || null,
      response_state: requestContract.operation_class === "report" ? "report_ready" : requestContract.operation_class === "recommend" ? "recommendation" : "informational",
    });
    return {
      id: text(shapedCanonical.id) || `oyi-runtime:${requestContract.conversation_request_id}`,
      thread_id: persistedThreadId || null,
      intent: cleanLabel(shapedCanonical.intent, requestContract.intent),
      understood: text(shapedCanonical.understood) || null,
      summary: cleanLabel(shapedCanonical.understood || shapedCanonical.message, "Oyi reviewed the current operational context."),
      answer: cleanLabel(shapedCanonical.reply || shapedCanonical.message, "Oyi reviewed the current operational context."),
      reply: cleanLabel(shapedCanonical.reply || shapedCanonical.message, "Oyi reviewed the current operational context."),
      message: cleanLabel(shapedCanonical.message || shapedCanonical.reply, "Oyi reviewed the current operational context."),
      display_mode: (text(shapedCanonical.display_mode) as CanonicalConversationResponse["display_mode"]) || "conversation",
      truth,
      operational_object: resolved.object,
      context: {
        surface: input.surface,
        estate_id: input.estate_id || oisContext?.estate_id || null,
        home_id: input.home_id || oisContext?.home_id || null,
        module: input.module || oisContext?.module || null,
        context_source: resolved.source,
        warnings: responseWarnings,
        target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationTruthState: hydration.truth_state, hydrationReason: hydration.reason, scopeWidened: false },
        module_facts: moduleFacts,
        request_contract: requestContract,
      },
      resolved_turn: recordOf(shapedCanonical.resolved_turn) as ResolvedConversationTurn,
      execution: {
        ...recordOf(shapedCanonical.execution),
        normalized_turn: normalizedTurn,
        resolved_oyi_turn: resolvedOyiTurn,
        workflow: activeWorkflow,
      },
      cards: Array.isArray(shapedCanonical.cards) ? shapedCanonical.cards as Array<Record<string, unknown>> : [],
      sources: Array.isArray(shapedCanonical.sources) ? shapedCanonical.sources as Array<Record<string, unknown>> : [],
      suggested_actions: Array.isArray(shapedCanonical.suggested_actions) ? shapedCanonical.suggested_actions as Array<Record<string, unknown>> : [],
      awareness: shapedCanonical.awareness ? recordOf(shapedCanonical.awareness) : undefined,
      presentation_policy: recordOf(shapedCanonical.presentation_policy) as ConversationPresentationPolicy,
      confirmations: Array.isArray(shapedCanonical.confirmations) ? shapedCanonical.confirmations as Array<Record<string, unknown>> : [],
      warnings: responseWarnings,
      persistence_saved: Boolean(persistedThreadId),
      source: "oyi_canonical_runtime",
      safe_mode: true,
      approvalRequired: Boolean(shapedCanonical.approvalRequired || shapedCanonical.requiresConfirmation || (Array.isArray(shapedCanonical.confirmations) && shapedCanonical.confirmations.length)),
      requiresConfirmation: Boolean(shapedCanonical.requiresConfirmation || shapedCanonical.approvalRequired || (Array.isArray(shapedCanonical.confirmations) && shapedCanonical.confirmations.length)),
    };
  }
  if (requestContract.operation_class === "read" || requestContract.operation_class === "report" || requestContract.operation_class === "recommend") {
    logger.info("conversation_read_only_execution_blocked", {
      operation_class: requestContract.operation_class,
      intent: requestContract.intent,
      target: requestContract.target,
      attempted_operation: "legacy_mutation_fallback",
    });
    if (requestContract.scope_mode === "exact_target" && resolved.object) {
      const answer = `I can answer for ${resolved.object.label}, but this exact read operation is not supported yet. I did not widen to the home inventory or execute any command.`;
      const shapedCanonical = {
        id: `oyi-runtime:${requestContract.conversation_request_id}`,
        thread_id: requestContract.thread_id || randomUUID(),
        intent: requestContract.intent,
        understood: `Exact target retained for ${resolved.object.label}.`,
        message: answer,
        reply: answer,
        display_mode: "detail",
        confidence: 0.7,
        execution: { status: "read_only", current_turn_execution: false, normalized_turn: normalizedTurn, resolved_oyi_turn: resolvedOyiTurn, workflow: activeWorkflow },
        sources: [],
        cards: [],
        suggested_actions: contextualObjectActions(resolved.object, input).filter((action) => recordOf(action).risk !== "control").slice(0, 4),
        awareness: { headline: "Exact target retained", summary: answer, severity: "info" },
        presentation_policy: presentationPolicyForContract(requestContract),
        facts: [],
      };
      const truth = canonicalTruthFor(shapedCanonical, resolved.object);
      const threadId = text(shapedCanonical.thread_id) || text(input.thread_id) || randomUUID();
      const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, { ...shapedCanonical, thread_id: threadId }, truth, resolved.object, requestContract);
      const responseWarnings = [
        ...resolved.warnings,
        ...(!persistedThreadId ? ["This answer was not saved to conversation history."] : []),
      ];
      logger.info("conversation_inventory_fallback_blocked", {
        target_id: requestContract.target.canonical_id,
        targeted_intent: requestContract.intent,
        reason: "exact_target_read_authority",
      });
      return {
        id: text(shapedCanonical.id),
        thread_id: persistedThreadId || null,
        intent: requestContract.intent,
        understood: text(shapedCanonical.understood),
        summary: answer,
        answer,
        reply: answer,
        message: answer,
        display_mode: "detail",
        truth,
        operational_object: resolved.object,
        context: {
          surface: input.surface,
          estate_id: input.estate_id || oisContext?.estate_id || null,
          home_id: input.home_id || oisContext?.home_id || null,
          module: input.module || oisContext?.module || null,
          context_source: resolved.source,
          warnings: responseWarnings,
          target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationTruthState: hydration.truth_state, hydrationReason: hydration.reason, scopeWidened: false },
          module_facts: moduleFacts,
          request_contract: requestContract,
        },
        resolved_turn: resolvedConversationTurnFromContract(input, requestContract, resolved.object),
        execution: { status: "read_only", current_turn_execution: false },
        cards: [],
        sources: [],
        suggested_actions: Array.isArray(shapedCanonical.suggested_actions) ? shapedCanonical.suggested_actions as Array<Record<string, unknown>> : [],
        awareness: shapedCanonical.awareness,
        presentation_policy: recordOf(shapedCanonical.presentation_policy) as ConversationPresentationPolicy,
        confirmations: [],
        warnings: responseWarnings,
        persistence_saved: Boolean(persistedThreadId),
        source: "oyi_canonical_runtime",
        safe_mode: true,
        approvalRequired: false,
        requiresConfirmation: false,
      };
    }
  }
  const compatibilityInput = compatibilityInputFromCanonical(input, resolved.object);
  // Programme 4 Phase J — this is the second-hop fallback into the fully
  // legacy oyiUnifiedIntelligenceService engine (Phase A/D: reachable from
  // /ai/chat, /office/*, /communications/* whenever this runtime's own
  // "exact target read" short-circuit doesn't apply). It previously had no
  // metric at all, making Phase D's capability-truth-duplication retirement
  // decision impossible to evidence. Counted here so future deletion
  // decisions (Phase O) can be evidence-based, not guessed.
  operationalMetrics.increment("oyi_canonical_runtime_legacy_service_fallback_total", {
    surface: String(input.surface || "unknown"),
    module: String(input.module || "unknown"),
  });
  const compatibility = await runOyiUnifiedChat(actor, compatibilityInput) as Record<string, unknown>;
  const shapedCompatibility = shapeObjectConversation(input, compatibility, resolved.object);
  const truth = canonicalTruthFor(shapedCompatibility, resolved.object);
  const threadId = text(shapedCompatibility.thread_id) || text(input.thread_id) || randomUUID();
  const persistedThreadId = await persistCanonicalAuthoritativeMessages(actor, input, { ...shapedCompatibility, thread_id: threadId }, truth, resolved.object, requestContract);
  const responseWarnings = [
    ...resolved.warnings,
    ...(targetResolution.ambiguous && targetResolution.clarificationQuestion ? [targetResolution.clarificationQuestion] : []),
    ...(threadContext.warning ? [threadContext.warning] : []),
    ...(!persistedThreadId ? ["This answer was not saved to conversation history."] : []),
  ];
  return {
    id: text(shapedCompatibility.id) || `oyi-runtime:${randomUUID()}`,
    thread_id: persistedThreadId || null,
    intent: cleanLabel(shapedCompatibility.intent, "information"),
    understood: text(shapedCompatibility.understood) || null,
    summary: cleanLabel(shapedCompatibility.understood || shapedCompatibility.message, "Oyi reviewed the current operational context."),
    answer: cleanLabel(shapedCompatibility.reply || shapedCompatibility.message, "Oyi reviewed the current operational context."),
    reply: cleanLabel(shapedCompatibility.reply || shapedCompatibility.message, "Oyi reviewed the current operational context."),
    message: cleanLabel(shapedCompatibility.message || shapedCompatibility.reply, "Oyi reviewed the current operational context."),
    display_mode: (text(shapedCompatibility.display_mode) as CanonicalConversationResponse["display_mode"]) || "conversation",
    truth,
    operational_object: resolved.object,
    context: {
      surface: input.surface,
      estate_id: input.estate_id || oisContext?.estate_id || null,
      home_id: input.home_id || oisContext?.home_id || null,
      module: input.module || oisContext?.module || null,
      context_source: resolved.source,
      warnings: responseWarnings,
      target_resolution: { ...targetResolution, hydrationStatus: hydration.status, hydrationSource: hydration.source, hydrationTruthState: hydration.truth_state, hydrationReason: hydration.reason, scopeWidened: false },
      module_facts: moduleFacts,
    },
    resolved_turn: recordOf(shapedCompatibility.resolved_turn) as ResolvedConversationTurn,
    execution: {
      ...recordOf(shapedCompatibility.execution),
      normalized_turn: normalizedTurn,
      resolved_oyi_turn: resolvedOyiTurn,
      workflow: activeWorkflow,
    },
    cards: Array.isArray(shapedCompatibility.cards) ? shapedCompatibility.cards as Array<Record<string, unknown>> : [],
    sources: Array.isArray(shapedCompatibility.sources) ? shapedCompatibility.sources as Array<Record<string, unknown>> : [],
    suggested_actions: Array.isArray(shapedCompatibility.suggested_actions) ? shapedCompatibility.suggested_actions as Array<Record<string, unknown>> : [],
    awareness: shapedCompatibility.awareness ? recordOf(shapedCompatibility.awareness) : undefined,
    presentation_policy: presentationPolicyForContract(requestContract),
    confirmations: Array.isArray(shapedCompatibility.confirmations) ? shapedCompatibility.confirmations as Array<Record<string, unknown>> : [],
    warnings: responseWarnings,
    persistence_saved: Boolean(persistedThreadId),
    source: "oyi_canonical_runtime",
    safe_mode: true,
    approvalRequired: Boolean(shapedCompatibility.approvalRequired || shapedCompatibility.requiresConfirmation || recordOf(shapedCompatibility.execution).status === "pending_confirmation"),
    requiresConfirmation: Boolean(shapedCompatibility.requiresConfirmation || shapedCompatibility.approvalRequired || recordOf(shapedCompatibility.execution).status === "pending_confirmation"),
  };
}
