import type { CanonicalConversationRequestContext, ConversationRunResult } from "../contracts/conversation";
import type { CanonicalTruth, ConversationBuilderKey } from "../contracts/canonicalConversation";
import type { DomainResult } from "../contracts/domainResult";
import type { ResolvedTurn } from "../contracts/resolvedTurn";
import { parseSemanticFrame } from "../interpretation/SemanticFrameParser";
import type { CanonicalIntent, IntelligenceRequestContract, OperationClass, ScopeMode } from "../interpretation/conversationIntentRouting";
import { ConversationTracer } from "../observability/ConversationTracer";
import { legacyConversationAdapter } from "../legacy/LegacyConversationAdapter";
import { capabilityRegistry } from "../capabilities/CapabilityRegistry";
import { capabilityService } from "../capabilities/CapabilityService";
import { buildCapabilityAdvertisingResult } from "../capabilities/CapabilityAdvertisingPresentation";
import { capabilityDomainResultToConversationResponse } from "../capabilities/CapabilityResponseAdapter";
import { buildDeviceActionCapabilities, continueDeviceActionWorkflow } from "../capabilities/DeviceActionCapabilityModules";
import { buildPhaseBReadCapabilities, resultPresentation } from "../capabilities/ReadCapabilityModules";
import { buildOfficeInternalReadCapabilities, buildPublicCorporateReadCapabilities, taskBatchContextSlot } from "../capabilities/OfficeCorporateCapabilityModules";
import { buildOfficeActionCapabilities } from "../capabilities/OfficeActionCapabilityModules";
import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import { persistCanonicalConversationTurn } from "../persistence/canonicalConversationPersistence";
import { resolveTurnAuthority } from "./TurnAuthorityResolver";
import { assertNoUnverifiedGenericSuccess } from "../presentation/FallbackFirewall";
import { logger } from "../../observability/logger";
import { actionService, workflowService } from "../workflows/defaultWorkflowActionServices";
import { DeviceConversationActionAdapter } from "../domains/devices/deviceActionAdapter";
import type { OyiWorkflow } from "../contracts/workflow";
import { assertClaimDoesNotPromoteUnavailable, type CanonicalClaimState, type CanonicalResponseClaim } from "../contracts/evidence";
import type { OyiEvidence } from "../contracts/evidence";
import type { IntelligenceFact } from "../contracts/canonicalConversation";
import { evidenceEnvelope } from "../evidence/EvidenceEnvelope";
import { parseFollowUpIntent, resolveFollowUpReference, resolveFilterFollowUp, parseDomainSwitchIntent, clarificationCandidatesFromRefs, type FollowUpIntent } from "../interpretation/followUpResolver";
import { loadThreadResultSetContext, loadThreadResultSetsContext, narrowedResultSetContext, filteredResultSetContext, type ResultSetContext } from "../context/resultSetContext";
import { isOfficeResultSetDomain, officeFactFromRef, officeFollowUpAnswer } from "../context/officeResultSetReference";
import { hydrateCanonicalTarget } from "../runtime/canonicalTargetHydrationRegistry";
import { buildExplainAnswer, buildStatusCheckAnswer, buildFieldAnswer } from "../domains/explainAnswer";
import { objectStateLine } from "../presentation/objectFallbackPresentation";
import { buildUtilitySpendingComparisonAnswer } from "../domains/utilities/utilityConversationAnswers";
import {
  resolveOfficeConversationContinuity,
  populatedOfficeContextSlot,
  isOfficeRecordDomain,
  hasExplicitDomainSwitchSignal,
  buildOfficeActiveContext,
  buildOfficeDomainOnlyActiveContext,
} from "../context/officeConversationContext";
import {
  loadPendingOfficeActionProposal,
  loadConfirmedOfficeActionProposal,
  isOfficeConfirmationText,
  isOfficeCancellationText,
  proposalPublicView,
  parseTaskRevisionIntent,
  parseTaskMutationIntent,
  parseMeetingMutationIntent,
  parseSupportMutationIntent,
  parseAutomationMutationIntent,
  parsePortfolioMutationIntent,
  parsePartnershipMutationIntent,
  mergeTaskRevisionIntoProposal,
} from "../context/officeActionProposal";
import { buildLastVerifiedOfficeAction } from "../context/officeAutomationSuggestion";
import type { GovernedActionProposal } from "../../contracts/governedAction";

let registered = false;

function boolFlag(name: string, fallback = true) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !/^(0|false|off|disabled)$/i.test(String(value));
}

function ensureRegistered() {
  if (registered) return;
  for (const capability of buildPhaseBReadCapabilities()) capabilityRegistry.register(capability);
  for (const capability of buildDeviceActionCapabilities()) capabilityRegistry.register(capability);
  for (const capability of buildOfficeInternalReadCapabilities()) capabilityRegistry.register(capability);
  for (const capability of buildOfficeActionCapabilities()) capabilityRegistry.register(capability);
  for (const capability of buildPublicCorporateReadCapabilities()) capabilityRegistry.register(capability);
  registered = true;
}

function scopeModeFor(turn: ResolvedTurn): ScopeMode {
  if (turn.target?.canonical_id) return "exact_target";
  if (turn.scope.room_id) return "room_scope";
  if (turn.scope.home_id) return "home_scope";
  if (turn.scope.building_id) return "building_scope";
  if (turn.scope.estate_id) return "estate_scope";
  return "global_scope";
}

function temporalScopeFor(turn: ResolvedTurn): IntelligenceRequestContract["temporal_scope"] {
  const mode = turn.temporal_scope?.mode;
  if (mode === "history") return { mode: "historical", from: turn.temporal_scope?.from || null, to: turn.temporal_scope?.to || null };
  if (mode === "today" || mode === "yesterday" || mode === "recent") {
    return { mode, from: turn.temporal_scope?.from || null, to: turn.temporal_scope?.to || null };
  }
  if (mode === "current_month") return { mode: "custom", from: turn.temporal_scope?.from || null, to: turn.temporal_scope?.to || null };
  if (mode === "range") return { mode: "custom", from: turn.temporal_scope?.from || null, to: turn.temporal_scope?.to || null };
  return { mode: "current", from: null, to: null };
}

function intentForCapability(capability: CapabilityModule, turn: ResolvedTurn): CanonicalIntent {
  if (capability.key === "global.capabilities.read") return "capability";
  if (capability.key === "devices.availability.read") return "device_availability_inventory";
  if (capability.key === "devices.activity.read") return "activity_history";
  if (capability.key === "devices.failures.read") return "failure_history";
  if (capability.key === "devices.diagnosis.read") return "diagnosis";
  if (capability.key === "devices.relationships.read") return "relationships";
  if (capability.domain === "wallet") return "wallet_operation";
  if (capability.key === "utilities.spending.read") return "wallet_operation";
  return turn.operation === "list" ? "information" : "current_state";
}

function operationClassForCapability(capability: CapabilityModule, turn: ResolvedTurn): OperationClass {
  if (capability.key === "global.capabilities.read") return "list";
  if (capability.key === "utilities.spending.read") return "report";
  return turn.operation === "list" ? "list" : "read";
}

function builderKeyForCapability(capability: CapabilityModule): ConversationBuilderKey {
  if (capability.key === "global.capabilities.read") return "domain_list";
  if (capability.key === "wallet.transactions.read") return "wallet_history";
  if (capability.key === "utilities.spending.read") return "utility_spending";
  if (capability.key === "devices.availability.read") return "offline_inventory";
  if (capability.key === "devices.activity.read") return "device_activity";
  if (capability.key === "devices.failures.read") return "device_failures";
  if (capability.key === "devices.diagnosis.read") return "device_diagnosis";
  if (capability.key === "devices.relationships.read") return "device_relationships";
  return "general_help";
}

function evidenceRequirementsForCapability(capability: CapabilityModule): IntelligenceRequestContract["evidence_requirements"] {
  const evidence = new Set((capability.evidence_requirements || []).map((requirement) => requirement.evidence_type));
  return {
    current_state: capability.domain === "devices" || evidence.has("device_availability") || evidence.has("utility_status"),
    recent_events: evidence.has("execution_history") || evidence.has("recent_activity"),
    execution_history: evidence.has("execution_history"),
    audit_history: evidence.has("audit"),
    relationships: evidence.has("relationship_context"),
    permissions: true,
    provider_state: capability.domain === "devices",
    financial_ledger: capability.domain === "wallet" || capability.domain === "utilities",
    access_records: capability.domain === "visitors" || capability.domain === "security",
  };
}

function fallbackAnswerForCapability(capability: CapabilityModule, reason: string) {
  if (capability.key === "utilities.active.read") {
    return "I can’t confirm your active utility services from the available evidence right now. You can review connected services in Utilities.";
  }
  if (reason === "capability_disabled") return `That ${capability.domain} capability is not available from this surface right now.`;
  if (reason === "capability_declared") return `I understand this as a ${capability.domain} request, but that capability is not available in this release yet.`;
  return `I understand this as a ${capability.domain} request, but I can’t confirm it from an enabled capability yet.`;
}

function isConfirmationText(message: unknown) {
  return /^(yes|confirm|proceed|go ahead|turn it (on|off)|do it)$/i.test(String(message ?? "").trim());
}

function isCancellationText(message: unknown) {
  return /^(cancel|never mind|nevermind|don't do it|do not do it|stop)$/i.test(String(message ?? "").trim());
}

function isContinueText(message: unknown) {
  return /^(continue|what were we doing|resume|show pending|show me the pending action)$/i.test(String(message ?? "").trim());
}

function explicitWorkflowReference(context: CanonicalConversationRequestContext) {
  const requestContext = context.input.context && typeof context.input.context === "object" ? context.input.context as Record<string, any> : {};
  const activeWorkflow = requestContext.active_workflow && typeof requestContext.active_workflow === "object" ? requestContext.active_workflow as Record<string, any> : {};
  const pendingWorkflow = requestContext.pending_workflow && typeof requestContext.pending_workflow === "object" ? requestContext.pending_workflow as Record<string, any> : {};
  return String(context.input.workflow_id || requestContext.workflow_id || activeWorkflow.workflow_id || pendingWorkflow.workflow_id || "").trim() || null;
}

function isDeviceActionFrame(frame: ReturnType<typeof parseSemanticFrame>) {
  return frame.domain === "devices" && (frame.operation === "device.power.on" || frame.operation === "device.power.off");
}

function safeErrorCode(error: unknown) {
  const value = error as any;
  return String(value?.code || value?.safe_error_code || value?.name || "internal_runtime_failure");
}

function safeErrorClass(error: unknown) {
  const value = error as any;
  return String(value?.name || value?.constructor?.name || "Error");
}

function deviceActionOrchestratorTrace(event: string, context: CanonicalConversationRequestContext, turn: ResolvedTurn | null, tracer: ConversationTracer, fields: Record<string, unknown> = {}) {
  logger.info(event, {
    request_id: turn?.request_id || tracer.requestId,
    correlation_id: turn?.correlation_id || tracer.correlationId,
    thread_id: context.input.thread_id || null,
    actor_id: context.actor?.id || null,
    surface: context.input.surface,
    semantic_operation: turn?.semantic_frame.operation || null,
    capability_key: "devices.power.control",
    ...fields,
  });
}

async function pendingWorkflowStatusResult(workflow: OyiWorkflow): Promise<DomainResult | null> {
  if (workflow.status !== "awaiting_approval" || !workflow.action_id) return null;
  const action = await actionService.get(workflow.action_id);
  if (!action || action.status !== "awaiting_confirmation") return null;
  const label = action.target.label || workflow.target?.label || "the selected device";
  const channel = action.target.channel_code ? ` ${action.target.channel_code.replace(/^switch_/i, "Channel ")}` : "";
  const desired = action.requested_state === true ? "turn on" : action.requested_state === false ? "turn off" : "control";
  return {
    status: "awaiting_confirmation",
    answer: `The pending action is: ${desired}${channel} on ${label}. Please confirm or cancel.`,
    actions: [
      { action_type: "approval", label: "Confirm", workflow_id: workflow.workflow_id, action_id: action.action_id },
      { action_type: "cancel", label: "Cancel", workflow_id: workflow.workflow_id, action_id: action.action_id },
    ],
    presentation_policy: { primary: "approval", allowed_supporting_blocks: ["text", "approval"], allowed_action_types: ["approval", "cancel"], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
    metadata: {
      workflow_id: workflow.workflow_id,
      action_id: action.action_id,
      confirmations: [{
        type: "device_command_confirmation",
        workflow_id: workflow.workflow_id,
        action_id: action.action_id,
        target_id: action.target.canonical_id,
        target_type: action.target.object_type,
        label,
        channel_code: action.target.channel_code || null,
        command: action.requested_operation,
        desired_state: action.requested_state,
        risk: "device_control",
      }],
    },
  };
}

async function durableWorkflowContinuationResult(context: CanonicalConversationRequestContext, workflow: OyiWorkflow, capability: CapabilityModule): Promise<DomainResult | null> {
  const actionId = String(workflow.action_id || "");
  if (isCancellationText(context.input.message)) {
    const action = actionId ? await actionService.get(actionId) : null;
    if (action && action.status === "awaiting_confirmation") await actionService.cancel(action, context.actor?.id || null);
    const cancelled = await workflowService.cancel(workflow);
    return {
      status: "answered",
      answer: "Cancelled. I did not send that device command.",
      presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
      metadata: { workflow_id: cancelled.workflow_id, action_id: actionId || null, workflow_status: cancelled.status },
    };
  }
  if (!isConfirmationText(context.input.message)) return null;
  const action = actionId ? await actionService.get(actionId) : null;
  if (!action || action.status !== "awaiting_confirmation") {
    return {
      status: "unavailable",
      answer: "I do not have a live pending action that matches this confirmation.",
      presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
      metadata: { workflow_id: workflow.workflow_id, action_id: actionId || null },
    };
  }
  const authority = capabilityService.canUse(capability.key, {
    actor: context.actor,
    oisContext: context.oisContext,
    surface: context.input.surface,
    scope: {
      estate_id: action.target.estate_id || workflow.target?.estate_id || context.oisContext?.estate_id || null,
      building_id: null,
      home_id: action.target.home_id || workflow.target?.home_id || context.oisContext?.home_id || null,
      room_id: action.target.room_id || workflow.target?.room_id || context.input.room_id || null,
    },
  });
  if (!authority.allowed) {
    return {
      status: "permission_restricted",
      answer: "I cannot execute that pending device command because your current permission or surface no longer allows it.",
      presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
      metadata: { workflow_id: workflow.workflow_id, action_id: action.action_id, reason: authority.reason },
    };
  }
  const approved = await actionService.approve(action, context.actor?.id || null);
  const executed = await actionService.executeWithAdapter(approved, new DeviceConversationActionAdapter(context.actor as any, {
    estateId: authority.scope.estate_id,
    homeId: authority.scope.home_id,
    roomId: authority.scope.room_id,
  }));
  const terminalWorkflow = await workflowService.transition(workflow, executed.status === "confirmed" || executed.status === "unobservable" ? "completed" : "failed", {
    execution_record: { action_id: executed.action_id, action_status: executed.status, result: executed.result || null },
  });
  const target = executed.target.label || "the selected device";
  const answer = executed.status === "confirmed"
    ? `${target} command completed and was confirmed.`
    : executed.status === "unobservable"
      ? `${target} command was accepted. Oyi cannot directly observe the final physical effect, so I recorded it as unobservable.`
      : `I could not complete that device command. ${String(executed.safe_error?.message || "")}`.trim();
  return {
    status: executed.status === "confirmed" || executed.status === "unobservable" ? "answered" : "unavailable",
    answer,
    presentation_policy: { primary: "execution", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
    metadata: { workflow_id: terminalWorkflow.workflow_id, action_id: executed.action_id, action_status: executed.status },
  };
}

function nonEnabledCapabilityResult(capability: CapabilityModule, reason: string): DomainResult {
  return {
    status: capability.rolloutStatus === "disabled" ? "unsupported" : "unavailable",
    answer: fallbackAnswerForCapability(capability, reason),
    actions: capability.key === "utilities.active.read"
      ? [{ label: "Open Utilities", route: "/utilities", action_type: "navigation", capability_key: capability.key }]
      : [],
    presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
    metadata: {
      capability_key: capability.key,
      rollout_status: capability.rolloutStatus,
      fallback_reason: reason,
      fallback_owner: "canonical_capability_fallback",
    },
  };
}

function claimStateForResultStatus(status: DomainResult["status"]): CanonicalClaimState {
  if (status === "unavailable") return "unavailable";
  if (status === "unsupported") return "unsupported";
  if (status === "permission_restricted") return "permission_restricted";
  if (status === "draft" || status === "awaiting_confirmation") return "inferred";
  // "answered" and "empty" are both confirmed claims about the world (a
  // populated list, or a positively-confirmed empty one) — this is exactly
  // the pairing assertClaimDoesNotPromoteUnavailable exists to police: it
  // must never be reached while the evidence backing it is unavailable or
  // permission-restricted.
  return "confirmed";
}

// Wires up contracts/evidence.ts's Phase A safety invariant — previously
// declared but never called — for every enabled read capability response.
// A violation here is a real capability bug (a handler reporting
// answered/empty while its own evidence says unavailable/restricted); it is
// caught and downgraded rather than thrown, because nothing upstream of the
// canonical runtime currently guarantees an async rejection here becomes a
// clean HTTP error instead of an unhandled rejection.
function enforceReadResultRespectsEvidence(input: {
  capability: CapabilityModule;
  result: DomainResult;
  evidence: OyiEvidence[];
  tracer: ConversationTracer;
}): DomainResult {
  const { capability, result, evidence, tracer } = input;
  if (!evidence.length) return result;
  const claim: CanonicalResponseClaim = {
    claim_id: `${capability.key}:${tracer.requestId}`,
    domain: capability.domain,
    statement: result.answer,
    state: claimStateForResultStatus(result.status),
    evidence_ids: evidence.map((item) => item.evidence_id),
    fact_ids: [],
    inference_ids: [],
    confidence: null,
    privacy_class: evidence[0]?.privacy_class || "household_private",
    generated_at: new Date().toISOString(),
    limitations: [],
  };
  try {
    assertClaimDoesNotPromoteUnavailable(claim, evidence);
    return result;
  } catch (error) {
    logger.error("oyi_capability_claim_evidence_violation", {
      request_id: tracer.requestId,
      correlation_id: tracer.correlationId,
      capability_key: capability.key,
      domain: capability.domain,
      result_status: result.status,
      evidence_count: evidence.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: "unavailable",
      answer: "I could not confirm that evidence-backed answer safely, so I am not reporting it as confirmed.",
      presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
      metadata: { capability_key: capability.key, fallback_reason: "claim_evidence_violation", fallback_owner: "canonical_claim_guard" },
    };
  }
}

function requestContractForCapability(context: CanonicalConversationRequestContext, turn: ResolvedTurn, capability: CapabilityModule): IntelligenceRequestContract {
  const builderKey = builderKeyForCapability(capability);
  return {
    conversation_request_id: turn.request_id,
    thread_id: context.input.thread_id || null,
    surface: context.input.surface,
    operation_class: operationClassForCapability(capability, turn),
    intent: intentForCapability(capability, turn),
    scope_mode: scopeModeFor(turn),
    temporal_scope: temporalScopeFor(turn),
    target: {
      object_type: turn.target?.object_type || (capability.domain === "wallet" ? "wallet" : null),
      canonical_id: turn.target?.canonical_id || null,
      parent_id: turn.target?.parent_id || null,
      channel_code: turn.target?.channel_code || null,
      label: turn.target?.label || null,
    },
    mutation: {
      requested: false,
      confirmed: false,
      command: null,
      desired_state: null,
      risk_class: capability.risk_class || "read",
    },
    evidence_requirements: evidenceRequirementsForCapability(capability),
    answer_builder: builderKey,
    report_builder: capability.key === "utilities.spending.read" ? capability.key : null,
    truth_policy: "evidence_required",
    confidence: turn.semantic_frame.confidence || 0.86,
  };
}

// Oyi Conversational Runtime Completion Programme, Phase 2. Recomputed
// from the FINAL context (already continuity-adjusted, whether the slot
// arrived live from Office's frontend this turn or was reinjected from
// persisted memory) rather than threaded through as a separate flag, so
// this stays correct regardless of which path produced the answer.
//   - populated slot matches the domain that actually answered -> fresh
//     memory, refreshing the expiry window (a normal grounded turn).
//   - that domain answered but explicit switch-away language was used
//     and nothing matches it -> null, clearing stale memory on purpose.
//   - anything else (a non-record business domain, or a record domain
//     with nothing populated and no switch signal) -> undefined, leaving
//     whatever's already persisted untouched (see persistCanonical
//     ConversationTurn's own undefined-vs-null handling).
function businessActiveContextForTurn(context: CanonicalConversationRequestContext, response: ConversationRunResult, capability: CapabilityModule): Record<string, unknown> | null | undefined {
  if (context.input.surface !== "office_internal") return undefined;
  const threadId = text(context.input.thread_id);
  if (!threadId) return undefined;
  const populated = populatedOfficeContextSlot(context as CapabilityContext);
  if (populated && populated.domain === capability.domain) {
    return buildOfficeActiveContext({
      threadId,
      actorId: text(context.actor?.id),
      populated,
      capabilityKey: capability.key,
      intentLabel: BUSINESS_CAPABILITY_LABELS[capability.key] || capability.key,
      userMessage: context.input.message,
      resultStatus: response.truth?.truth_state || null,
      resultAnswer: response.answer || response.message || null,
    });
  }
  // Phase 4 -- a LIST/aggregate capability (office_tasks.query.read: "show
  // me my overdue tasks") never populates a single-record *_context slot,
  // so the branch above never fires for it -- meaning a following
  // keyword-less follow-up ("move the first two to Monday") had no way to
  // know it was still about office_tasks. Domain-only continuity (no slot
  // to reinject) closes that gap for any office record domain, gated on a
  // genuine answer (never on a degraded/unavailable/restricted turn,
  // which shouldn't plant continuity for the next unrelated message).
  const genuineAnswer = response.truth?.truth_state === "observed" || response.truth?.truth_state === "confirmed";
  if (!populated && isOfficeRecordDomain(capability.domain) && genuineAnswer) {
    return buildOfficeDomainOnlyActiveContext({
      threadId,
      actorId: text(context.actor?.id),
      domain: capability.domain,
      capabilityKey: capability.key,
      intentLabel: BUSINESS_CAPABILITY_LABELS[capability.key] || capability.key,
      userMessage: context.input.message,
      resultStatus: response.truth?.truth_state || null,
      resultAnswer: response.answer || response.message || null,
    });
  }
  if (isOfficeRecordDomain(capability.domain) && hasExplicitDomainSwitchSignal(context.input.message)) {
    return null;
  }
  return undefined;
}

async function persistCapabilityResponse(context: CanonicalConversationRequestContext, response: ConversationRunResult, truth: CanonicalTruth, turn: ResolvedTurn, capability: CapabilityModule) {
  const contract = requestContractForCapability(context, turn, capability);
  logger.info("oyi_capability_persistence_started", {
    request_id: turn.request_id,
    correlation_id: turn.correlation_id,
    thread_id: response.thread_id || context.input.thread_id || null,
    actor_id: context.actor?.id || null,
    surface: context.input.surface,
    capability_key: capability.key,
  });
  const persistedThreadId = await persistCanonicalConversationTurn({
    actor: context.actor,
    oisContext: context.oisContext,
    request: context.input,
    response,
    truth,
    object: null,
    contract,
    builderKey: builderKeyForCapability(capability),
    businessActiveContext: businessActiveContextForTurn(context, response, capability),
    // hasOwnProperty, not `response.pending_action_proposal ?? undefined` --
    // the field is three-state (see canonicalConversation.ts), and most
    // capability responses never touch it at all, which must mean
    // "preserve", not "absent therefore undefined by coincidence".
    pendingActionProposal: Object.prototype.hasOwnProperty.call(response, "pending_action_proposal")
      ? (response as any).pending_action_proposal
      : undefined,
    lastVerifiedOfficeAction: Object.prototype.hasOwnProperty.call(response, "last_verified_office_action")
      ? (response as any).last_verified_office_action
      : undefined,
  });
  response.thread_id = persistedThreadId || response.thread_id || context.input.thread_id || null;
  response.persistence_saved = Boolean(persistedThreadId);
  logger.info(persistedThreadId ? "oyi_capability_persistence_completed" : "oyi_capability_persistence_failed", {
    request_id: turn.request_id,
    correlation_id: turn.correlation_id,
    thread_id: response.thread_id || null,
    actor_id: context.actor?.id || null,
    surface: context.input.surface,
    capability_key: capability.key,
    persistence_saved: Boolean(persistedThreadId),
  });
  return response;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const NO_ACTIONS_TEXT_PRESENTATION = { primary: "text" as const, allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none" as const, auto_navigation: false };

function syntheticFollowUpCapability(domain: string): CapabilityModule {
  return {
    key: `${domain}.followup`,
    domain: domain as any,
    rolloutStatus: "enabled",
    operations: [],
    supported_surfaces: ["consumer", "facility"],
    scope_requirements: [],
    permission_requirements: [],
    risk_class: "read",
    confirmation_policy: "none",
    evidence_requirements: [],
    presentation_policy: { primary: "text", expose_evidence: "summary", allow_internal_ids: false },
    supports: () => false,
    resolve: async () => ({ supported: true, reason: null }),
    collectEvidence: async () => [],
    buildReadResponse: async () => ({ status: "unavailable", answer: "" }),
  };
}

function evidenceFromFollowUpFact(fact: IntelligenceFact): OyiEvidence {
  return evidenceEnvelope({
    evidence_id: `followup:${fact.fact_id}`,
    domain: fact.domain as any,
    type: fact.fact_type,
    object_type: fact.object?.object_type || null,
    object_id: fact.object?.canonical_id || null,
    object_ref: { object_type: fact.object?.object_type || null, object_id: fact.object?.canonical_id || null, label: fact.object?.label || null },
    source: "domain_adapter",
    source_type: fact.source_type as any,
    source_id: fact.source_id || fact.fact_id,
    observed_at: fact.observed_at || fact.occurred_at || null,
    freshness: (["fresh", "stale", "expired", "unknown", "unobservable", "provider_disconnected"].includes(text(fact.freshness)) ? fact.freshness : "unknown") as OyiEvidence["freshness"],
    truth_class: fact.truth_state === "unavailable" ? "unavailable" : "source_record",
    privacy_class: "household_private",
    permissions: fact.permissions || [],
    authorised_scope: { estate_id: fact.scope?.estate_id || null, building_id: null, home_id: fact.scope?.home_id || null, room_id: fact.scope?.room_id || null },
    confidence: Number(fact.confidence || 0.75),
    payload: { fact },
  } as any);
}

// ---------------------------------------------------------------------
// Oyi Conversational Runtime Completion Programme, Phase 3 — Governed
// Action Proposals: the confirm/cancel/verify turn handler. A structural
// no-op for every surface except office_internal (mirrors Phase 2's
// resolveOfficeConversationContinuity exactly). Checked BEFORE normal
// capability resolution, same precedence position as the durable device-
// workflow continuation block above, but a separate mechanism -- see
// officeActionProposal.ts's header comment for why OyiWorkflow/
// ActionService (built for direct-backend execution) isn't reused here.
// ---------------------------------------------------------------------
function officeActionTitleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const OFFICE_PROPOSAL_FIELD_TO_CONTEXT_FIELD: Record<string, string> = { assignee: "owner" };

export function officeProposalFieldAndValue(proposal: GovernedActionProposal): { field: string; value: unknown } | null {
  const entries = Object.entries(proposal.proposed_state || {});
  if (!entries.length) return null;
  const [field, value] = entries[0];
  return { field, value };
}

// Phase 4, PR 5 -- the plural counterpart, needed once a proposal can
// carry more than one field (revision accumulation). officeProposalField
// AndValue above is left as-is (still correct for the single-field/
// first-field case every existing caller other than the verify loop
// below relies on).
export function officeProposalFieldsAndValues(proposal: GovernedActionProposal): Array<{ field: string; value: unknown }> {
  return Object.entries(proposal.proposed_state || {}).map(([field, value]) => ({ field, value }));
}

export function officeProposalValuesMatch(field: string, expected: unknown, observed: unknown): boolean {
  if (field === "due_at" || field === "scheduled_at") {
    const a = Date.parse(String(expected));
    const b = Date.parse(String(observed));
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return Math.abs(a - b) < 60_000;
  }
  if (field === "enabled") {
    return Boolean(expected) === (text(observed).toLowerCase() === "true");
  }
  return text(expected).toLowerCase() === text(observed).toLowerCase();
}

// Milestone 2 -- each domain's *OyiContext() shape (office.js) keys its
// batch-verify entry by a different ref field (task_ref/automation_ref/
// support_case_ref/meeting_ref/portfolio_ref/partnership_ref); this
// picks the right one so respondFromBatchVerification below can match a
// resent context entry back to the child proposal it came from,
// regardless of which domain the batch belongs to. Also the label used
// in the final verify answer ("N automations were updated" vs "N
// tasks..."), so the wording is honest for every batch-capable domain,
// not just Tasks.
const BATCH_DOMAIN_REF_KEY: Record<string, string> = {
  office_tasks: "task_ref",
  automations: "automation_ref",
  office_support: "support_case_ref",
  office_meetings: "meeting_ref",
  office_portfolio: "portfolio_ref",
  corporate_partnerships: "partnership_ref",
};
const BATCH_DOMAIN_LABEL: Record<string, string> = {
  office_tasks: "task",
  automations: "automation",
  office_support: "case",
  office_meetings: "meeting",
  office_portfolio: "portfolio entry",
  corporate_partnerships: "partnership",
};
// Milestone 2 -- generalizes revision accumulation ("actually Tuesday",
// then "and give it to Tony" merging into ONE proposal) beyond Tasks to
// every single-record write-capable domain. Tasks alone gets a genuine
// short-phrase revision parser (parseTaskRevisionIntent, which trusts
// the pending proposal's own operation to disambiguate a bare word like
// "Monday" or "Tony" from an unrelated sentence); every other domain
// falls back to its ordinary full-phrase mutation parser only ("assign
// this to Tony" works, a bare "Tony" does not) -- still real revision
// accumulation, just without the extra short-phrase convenience layer.
const REVISION_DOMAIN_INTENT_PARSER: Partial<Record<string, (message: string, pendingOperation: string) => { operation: string; field: string; rawValue: string; canonicalValue: unknown } | null>> = {
  office_tasks: (message, pendingOperation) => parseTaskRevisionIntent(message, pendingOperation) || parseTaskMutationIntent(message),
  office_meetings: (message) => parseMeetingMutationIntent(message),
  office_support: (message) => parseSupportMutationIntent(message),
  automations: (message) => parseAutomationMutationIntent(message),
  office_portfolio: (message) => parsePortfolioMutationIntent(message),
  corporate_partnerships: (message) => parsePartnershipMutationIntent(message),
};

const BATCH_DOMAIN_SURFACE_NAME: Record<string, string> = {
  office_tasks: "Tasks",
  automations: "Automations",
  office_support: "Support",
  office_meetings: "Meetings",
  office_portfolio: "Portfolio",
  corporate_partnerships: "Partnerships",
};

// Phase 4, PR 5 -- driven off proposed_state's own field names rather
// than parameters.canonical_value (the ORIGINAL field only, unchanged
// by mergeTaskRevisionIntoProposal) so a revision-accumulated
// multi-field proposal ("due date + owner") describes every change it
// actually made, not just the first one. Produces byte-identical text
// to the old per-operation branches for the single-field case.
function describeProposedFieldChange(label: string, field: string, value: unknown): string {
  if (field === "status" || field === "review_status") return `"${label}" is now ${officeActionTitleCase(text(value))}`;
  if (field === "assignee" || field === "assigned_staff") return `"${label}" is now assigned to ${text(value)}`;
  if (field === "due_at") return `"${label}"'s due date is now ${new Date(text(value)).toDateString()}`;
  if (field === "scheduled_at") return `"${label}" is now scheduled for ${new Date(text(value)).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  if (field === "priority") return `"${label}" is now ${text(value)} priority`;
  if (field === "enabled") return `"${label}" is now ${value ? "active" : "paused"}`;
  return `"${label}"'s ${field} is now ${text(value)}`;
}

// Phase 4, PR 5 -- the PROPOSAL-framing counterpart of
// describeProposedFieldChange above (that one says "is now X" for a
// VERIFIED change; this says "move/assign to X" for a PENDING one),
// used to build a combined description when mergeTaskRevisionIntoProposal
// accumulates more than one field.
function describeProposedFieldTarget(field: string, value: unknown): string {
  if (field === "status" || field === "review_status") return `move to ${officeActionTitleCase(text(value))}`;
  if (field === "assignee" || field === "assigned_staff") return `assign to ${text(value)}`;
  if (field === "due_at") return `move the due date to ${new Date(text(value)).toDateString()}`;
  if (field === "scheduled_at") return `move to ${new Date(text(value)).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  if (field === "priority") return `set to ${text(value)} priority`;
  if (field === "enabled") return value ? "resume" : "pause";
  return `update ${field} to ${text(value)}`;
}

function describeTaskRevision(proposedState: Record<string, unknown> | null, label: string): string {
  const entries = Object.entries(proposedState || {});
  if (!entries.length) return `Ready to update "${label}".`;
  const parts = entries.map(([field, value]) => describeProposedFieldTarget(field, value));
  return `Ready to ${parts.join(" and ")} for "${label}".`;
}

// Phase 4, PR 6 -- a compact, future-tense, name-friendly summary of
// what was just done (as opposed to officeProposalVerifiedDescription's
// past-tense "Done. X is now Y." framing), fed into "do that every
// Friday"'s suggested automation name.
// AutomationScheduleSuggestion's suggested_name becomes e.g. "move the
// due date to Tue Aug 25 2026 for "X" every Friday" -- reads naturally.
function automationSuggestionDescription(proposedState: Record<string, unknown> | null, label: string): string {
  const entries = Object.entries(proposedState || {});
  if (!entries.length) return `update "${label}"`;
  const parts = entries.map(([field, value]) => describeProposedFieldTarget(field, value));
  return `${parts.join(" and ")} for "${label}"`;
}

function officeProposalVerifiedDescription(proposal: GovernedActionProposal, label: string): string {
  if (proposal.operation === "resolve_case") return `Done. "${label}" is now resolved.`;
  const entries = Object.entries(proposal.proposed_state || {});
  if (!entries.length) return `Done. "${label}" was updated.`;
  if (entries.length === 1) return `Done. ${describeProposedFieldChange(label, entries[0][0], entries[0][1])}.`;
  return `Done. ${entries.map(([field, value]) => describeProposedFieldChange(label, field, value)).join(", and ")}.`;
}

// Phase 4, PR 4 -- confirming a batch proposal must confirm every child
// too (proposalPublicView only reveals a child's execute_directive once
// ITS OWN status is "confirmed", same rule as a single proposal), so
// Office's client-side loop over child_operations actually gets a
// directive for each one.
export function confirmProposalTree(proposal: GovernedActionProposal): GovernedActionProposal {
  return {
    ...proposal,
    status: "confirmed",
    child_operations: proposal.child_operations ? proposal.child_operations.map((child) => ({ ...child, status: "confirmed" })) : null,
  };
}

function syntheticOfficeActionCapability(key: string, domain: string): CapabilityModule {
  return {
    key,
    domain: domain as any,
    rolloutStatus: "enabled",
    operations: [],
    supported_surfaces: ["office_internal"],
    scope_requirements: [],
    permission_requirements: [],
    risk_class: "low_risk_action",
    confirmation_policy: "none",
    evidence_requirements: [],
    presentation_policy: { primary: "text", expose_evidence: "summary", allow_internal_ids: false },
    supports: () => false,
    resolve: async () => ({ supported: true, reason: null }),
    collectEvidence: async () => [],
  };
}

async function respondFromOfficeActionResult(
  context: CanonicalConversationRequestContext,
  resolvedTurn: ResolvedTurn,
  capability: CapabilityModule,
  result: DomainResult
): Promise<ConversationRunResult> {
  const capabilityContext: CapabilityContext = { ...context, resolvedTurn, legacyFallback: unavailableInsideFallback };
  let response = capabilityDomainResultToConversationResponse({ context: capabilityContext, capability, result, evidence: [] });
  response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, capability);
  return response;
}

// Phase 4, PR 4 -- batch counterpart of the single-record verify branch
// below. Office resends one rebuilt context entry per child it actually
// PATCHed (task_batch_context, see taskBatchContextSlot); a child with
// no matching entry (its PATCH call itself failed/was skipped
// client-side) counts as unverified, never silently as success. Honest
// partial-success reporting, never a blanket "done."
async function respondFromBatchVerification(
  context: CanonicalConversationRequestContext,
  resolvedTurn: ResolvedTurn,
  tracer: ConversationTracer,
  confirmed: GovernedActionProposal
): Promise<ConversationRunResult> {
  const batchEntries = taskBatchContextSlot(context as CapabilityContext);
  const refKey = BATCH_DOMAIN_REF_KEY[confirmed.domain] || "task_ref";
  const children = confirmed.child_operations || [];
  let verifiedCount = 0;
  const unverifiedLabels: string[] = [];
  for (const child of children) {
    const observedEntry = batchEntries.find((entry) => text(entry[refKey]) === child.target_entity_id);
    const proposedField = officeProposalFieldAndValue(child);
    const contextFieldKey = proposedField ? (OFFICE_PROPOSAL_FIELD_TO_CONTEXT_FIELD[proposedField.field] || proposedField.field) : null;
    const observed = observedEntry && contextFieldKey ? (observedEntry as Record<string, unknown>)[contextFieldKey] : undefined;
    const verified = Boolean(observedEntry && proposedField && officeProposalValuesMatch(proposedField.field, proposedField.value, observed));
    if (verified) {
      verifiedCount += 1;
    } else {
      unverifiedLabels.push(text(observedEntry?.title || observedEntry?.name) || child.target_entity_id);
    }
  }
  const total = children.length;
  logger.info("oyi_office_action_batch_verified", {
    request_id: tracer.requestId,
    correlation_id: tracer.correlationId,
    thread_id: context.input.thread_id || null,
    actor_id: context.actor?.id || null,
    proposal_id: confirmed.proposal_id,
    domain: confirmed.domain,
    operation: confirmed.operation,
    total,
    verified_count: verifiedCount,
  });
  const itemLabel = BATCH_DOMAIN_LABEL[confirmed.domain] || "record";
  const surfaceName = BATCH_DOMAIN_SURFACE_NAME[confirmed.domain] || "Office";
  let answer =
    total === 0
      ? "There was nothing in that batch to verify."
      : verifiedCount === total
      ? `Done. All ${total} ${itemLabel}${total === 1 ? "" : "s"} were updated as proposed.`
      : verifiedCount === 0
      ? `I attempted that, but none of the ${total} ${itemLabel}${total === 1 ? "" : "s"} show the expected change yet — please check ${total === 1 ? "it" : "them"} directly in ${surfaceName}.`
      : `${verifiedCount} of ${total} ${itemLabel}${total === 1 ? "" : "s"} were updated as proposed. Please check directly: ${unverifiedLabels.join(", ")}.`;
  // TEMPORARY diagnostic -- Milestone 2 production verification found
  // support batch reassign always reports 0/N verified even though the
  // PATCH itself demonstrably succeeds (confirmed directly against the
  // API). No Backend log access on this account (established in
  // Milestone 1); embedding the raw comparison inputs in the response
  // text is the same workaround used then. Reverted before this PR
  // series closes out.
  if (verifiedCount < total) {
    answer += ` [[DEBUG refKey=${refKey} batchEntries=${JSON.stringify(batchEntries)} children=${JSON.stringify(children.map((c) => ({ id: c.target_entity_id, field: officeProposalFieldAndValue(c) })))}]]`;
  }
  const capability = syntheticOfficeActionCapability(`${confirmed.domain}.batch_action_verified`, confirmed.domain);
  const allVerified = total > 0 && verifiedCount === total;
  const result: DomainResult = {
    status: "answered",
    answer,
    presentation_policy: resultPresentation("text"),
    // Phase 4, PR 6 -- same "only on FULL verification" rule as the
    // single-record path. Batch children all make the SAME kind of
    // change to different records, so the first child's proposed_state
    // describes the shared change; the label names the whole group.
    metadata: {
      pending_action_proposal: null,
      ...(allVerified
        ? { last_verified_office_action: buildLastVerifiedOfficeAction(confirmed, `${total} ${itemLabel}${total === 1 ? "" : "s"}`, automationSuggestionDescription(children[0]?.proposed_state || null, `${total} ${itemLabel}${total === 1 ? "" : "s"}`)) }
        : {}),
    },
  };
  return respondFromOfficeActionResult(context, resolvedTurn, capability, result);
}

async function handleOfficeActionProposalTurn(
  context: CanonicalConversationRequestContext,
  resolvedTurn: ResolvedTurn,
  tracer: ConversationTracer
): Promise<ConversationRunResult | null> {
  if (context.input.surface !== "office_internal" || !context.input.thread_id) return null;
  const threadId = context.input.thread_id;
  const actorId = context.actor?.id || null;
  const message = context.input.message;

  // 1) Verification turn -- a CONFIRMED proposal is waiting to be checked
  // against the authoritative resulting state. Only fires once the
  // client's fresh *_context slot actually reflects the SAME record the
  // proposal targeted; otherwise this falls through, leaving the
  // confirmed proposal for a later turn (up to its own expiry) rather
  // than forcing a verification against the wrong data.
  const confirmed = await loadConfirmedOfficeActionProposal(threadId, actorId);
  if (confirmed) {
    // Phase 4, PR 5 -- lifecycle precision. A client-side PATCH failure
    // (network error, permission denial at Office's own layer) previously
    // left the proposal "confirmed" in storage until its natural 10-minute
    // TTL, silently lingering rather than being explicitly resolved.
    // Office reports the failure directly (see confirmOyiActionProposal /
    // confirmBatchActionProposal in office.js) so this can close it out
    // immediately -- same "clear pending_action_proposal" mechanism
    // cancel/verified already use, just reached via a different route.
    const executionFailedReport = recordOf(context.input.context).execution_failed;
    if (executionFailedReport) {
      const failureReason = text(recordOf(context.input.context).execution_failure_reason) || null;
      logger.info("oyi_office_action_execution_failed", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: threadId,
        actor_id: actorId,
        proposal_id: confirmed.proposal_id,
        domain: confirmed.domain,
        operation: confirmed.operation,
        failure_reason: failureReason,
      });
      const capability = syntheticOfficeActionCapability(`${confirmed.domain}.action_execution_failed`, confirmed.domain);
      const result: DomainResult = {
        status: "answered",
        answer: `That change could not be completed${failureReason ? `: ${failureReason}` : "."} Nothing was verified as changed.`,
        presentation_policy: resultPresentation("text"),
        metadata: { pending_action_proposal: null },
      };
      return respondFromOfficeActionResult(context, resolvedTurn, capability, result);
    }
    if (confirmed.child_operations && confirmed.child_operations.length) {
      return respondFromBatchVerification(context, resolvedTurn, tracer, confirmed);
    }
    const populated = populatedOfficeContextSlot(context as CapabilityContext);
    if (populated && populated.domain === confirmed.domain && populated.ref === confirmed.target_entity_id) {
      // Phase 4, PR 5 -- checks EVERY field a revision-accumulated
      // proposal set, not just the first (officeProposalFieldAndValue),
      // so "due date + owner" both have to show up before this reports
      // full success; a proposal with only one field behaves exactly as
      // before.
      const proposedFields = officeProposalFieldsAndValues(confirmed);
      const fieldResults = proposedFields.map(({ field, value }) => {
        const contextFieldKey = OFFICE_PROPOSAL_FIELD_TO_CONTEXT_FIELD[field] || field;
        const observed = (populated.slot as Record<string, unknown>)[contextFieldKey];
        return { field, verified: officeProposalValuesMatch(field, value, observed) };
      });
      const verifiedCount = fieldResults.filter((r) => r.verified).length;
      const allVerified = fieldResults.length > 0 && verifiedCount === fieldResults.length;
      // title covers Tasks/Meetings/Support; name covers Automations/
      // Portfolio/Partnerships (each *OyiContext() shape's own label
      // field -- see office.js) -- checked in that order since some
      // shapes could theoretically carry both.
      const label = text((populated.slot as any)?.title) || text((populated.slot as any)?.name) || officeActionTitleCase(confirmed.target_entity_type);
      logger.info("oyi_office_action_verified", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: threadId,
        actor_id: actorId,
        proposal_id: confirmed.proposal_id,
        domain: confirmed.domain,
        operation: confirmed.operation,
        verified: allVerified,
        field_count: fieldResults.length,
        verified_count: verifiedCount,
      });
      const capability = syntheticOfficeActionCapability(`${confirmed.domain}.action_verified`, confirmed.domain);
      let answer: string;
      if (allVerified) {
        answer = officeProposalVerifiedDescription(confirmed, label);
      } else if (verifiedCount === 0) {
        answer = `I attempted that, but "${label}" doesn't show the expected change yet — please check it directly in ${officeActionTitleCase(confirmed.target_entity_type)}.`;
      } else {
        const unverifiedFields = fieldResults.filter((r) => !r.verified).map((r) => r.field).join(", ");
        answer = `Part of that change went through for "${label}", but not all of it (${unverifiedFields} doesn't show the expected value yet) — please check it directly in ${officeActionTitleCase(confirmed.target_entity_type)}.`;
      }
      const result: DomainResult = {
        status: "answered",
        answer,
        presentation_policy: resultPresentation("text"),
        // Phase 4, PR 6 -- only ever recorded on a FULLY verified change
        // (key omitted, not just falsy, when not allVerified -- absence
        // means "preserve whatever's already there" per the three-state
        // convention), so "do that every Friday" can never reference a
        // partially- or un-verified operation.
        metadata: {
          pending_action_proposal: null,
          ...(allVerified ? { last_verified_office_action: buildLastVerifiedOfficeAction(confirmed, label, automationSuggestionDescription(confirmed.proposed_state, label)) } : {}),
        },
      };
      return respondFromOfficeActionResult(context, resolvedTurn, capability, result);
    }
  }

  // 2) Confirm / cancel turn -- a PENDING proposal exists.
  const pending = await loadPendingOfficeActionProposal(threadId, actorId);
  if (pending) {
    if (isOfficeCancellationText(message)) {
      const capability = syntheticOfficeActionCapability(`${pending.domain}.action_cancelled`, pending.domain);
      const result: DomainResult = {
        status: "answered",
        answer: "Cancelled. No changes were made.",
        presentation_policy: resultPresentation("text"),
        metadata: { pending_action_proposal: null },
      };
      return respondFromOfficeActionResult(context, resolvedTurn, capability, result);
    }
    if (isOfficeConfirmationText(message)) {
      const confirmedProposal: GovernedActionProposal = confirmProposalTree(pending);
      const capability = syntheticOfficeActionCapability(`${pending.domain}.action_confirmed`, pending.domain);
      let confirmAnswer: string;
      if (pending.child_operations && pending.child_operations.length) {
        confirmAnswer = `Confirmed — updating ${pending.child_operations.length} task${pending.child_operations.length === 1 ? "" : "s"} now.`;
      } else {
        const populated = populatedOfficeContextSlot(context as CapabilityContext);
        const label = text((populated?.slot as any)?.title) || officeActionTitleCase(pending.target_entity_type);
        confirmAnswer = `Confirmed — updating "${label}" now.`;
      }
      const result: DomainResult = {
        status: "answered",
        answer: confirmAnswer,
        presentation_policy: resultPresentation("text"),
        metadata: { confirmations: [proposalPublicView(confirmedProposal)], pending_action_proposal: confirmedProposal },
      };
      return respondFromOfficeActionResult(context, resolvedTurn, capability, result);
    }
    // Neither confirm nor cancel. Phase 4, PR 5 -- revision accumulation.
    // A short correction ("actually make it Monday") is recognized via
    // the same-field loose parser; a message that names a DIFFERENT
    // field, whether short ("and give it to Tony") or a full phrase
    // ("assign this to Tony"), is recognized via the normal mutation
    // parser. Either way this now MERGES the change into the SAME
    // pending proposal (mergeTaskRevisionIntoProposal) instead of
    // replacing it wholesale -- "actually Tuesday" followed by "and give
    // it to Tony" lands as one proposal with both changes, not two
    // proposals where the second silently discards the first. Batch
    // proposals don't have a single task_context to revise against this
    // way -- accumulating a revision onto a batch is out of scope here;
    // skip so a short correction against a pending batch falls through
    // to normal routing instead of an incorrect reply.
    const revisionParser = REVISION_DOMAIN_INTENT_PARSER[pending.domain];
    if (revisionParser && !(pending.child_operations && pending.child_operations.length)) {
      const revisionIntent = revisionParser(message, pending.operation);
      if (revisionIntent) {
        const populated = populatedOfficeContextSlot(context as CapabilityContext);
        const label = text((populated?.slot as any)?.title) || text((populated?.slot as any)?.name) || officeActionTitleCase(pending.target_entity_type);
        // Milestone 2 -- captures the field's CURRENT live value from the
        // already-populated context slot the first time this field is
        // revised, so the multi-field diff card has a real "before" to
        // show, not just the "after" (see mergeTaskRevisionIntoProposal's
        // header note).
        const contextFieldKey = OFFICE_PROPOSAL_FIELD_TO_CONTEXT_FIELD[revisionIntent.field] || revisionIntent.field;
        const currentValue = (populated?.slot as Record<string, unknown> | undefined)?.[contextFieldKey];
        const merged = mergeTaskRevisionIntoProposal(pending, revisionIntent, "", currentValue);
        const description = describeTaskRevision(merged.proposed_state, label);
        const revisedProposal: GovernedActionProposal = { ...merged, description };
        const capability = syntheticOfficeActionCapability(`${pending.domain}.action_revised`, pending.domain);
        const result: DomainResult = {
          status: "awaiting_confirmation",
          answer: `${description} Reply "yes" to confirm, or "no" to cancel.`,
          presentation_policy: resultPresentation("approval"),
          metadata: { confirmations: [proposalPublicView(revisedProposal)], pending_action_proposal: revisedProposal },
        };
        return respondFromOfficeActionResult(context, resolvedTurn, capability, result);
      }
    }
  }
  return null;
}

function factFromHydration(hydration: Awaited<ReturnType<typeof hydrateCanonicalTarget>>): IntelligenceFact | null {
  if (hydration.status !== "hydrated" || !hydration.object) return null;
  const record = recordOf(hydration.facts).record || {};
  const object = hydration.object;
  return {
    fact_id: `hydrated:${object.object_type}:${object.canonical_id}`,
    domain: object.source_module || "unknown",
    fact_type: object.object_type,
    scope: { estate_id: object.estate_id, home_id: object.home_id, room_id: object.room_id },
    object: { object_type: object.object_type, canonical_id: object.canonical_id, label: object.label },
    statement: "",
    value: record,
    previous_value: null,
    occurred_at: hydration.freshness || null,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: object.canonical_id,
    truth_state: hydration.truth_state === "unavailable" ? "unavailable" : "confirmed",
    confidence: 0.85,
    freshness: hydration.freshness || "unknown",
    privacy_class: "household_private",
    permissions: [],
    evidence: [],
  };
}

// Generic, domain-agnostic detail answer for a follow-up-resolved object.
// why/status/field intents get grounded answers (see explainAnswer.ts);
// everything else (pronoun, ordinal, attribute, "tell me more") reuses the
// EXISTING generic per-object-type state-line presentation
// (objectFallbackPresentation.ts's objectStateLine) rather than new
// per-domain "tell me more" logic, per the programme's explicit instruction.
function followUpDetailAnswer(hydration: Awaited<ReturnType<typeof hydrateCanonicalTarget>>, intent: FollowUpIntent, fact: IntelligenceFact): string {
  if (intent.type === "why") return buildExplainAnswer(fact);
  if (intent.type === "status_check") return buildStatusCheckAnswer(fact);
  if (intent.type === "field") return buildFieldAnswer(fact, intent.field);
  return hydration.object ? objectStateLine(hydration.object) : "I could not confirm that item right now.";
}

// Re-invokes the SAME capability that produced the previous turn's result
// set, with the current (follow-up) message as input — temporalScopeFor
// (conversationContextLayers.ts) re-derives the timeframe from the new
// message's own wording ("what about last week?"), so no per-domain
// re-query logic is needed here; this works for any capability_key.
async function handleTemporalFollowUp(context: CanonicalConversationRequestContext, resolvedTurn: ResolvedTurn, resultSet: ResultSetContext, tracer: ConversationTracer): Promise<ConversationRunResult | null> {
  const capability = resultSet.capability_key ? capabilityRegistry.get(resultSet.capability_key) : null;
  if (!capability) return null;
  const capabilityContext = { ...context, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "followup_temporal") };
  const evidence = await capability.collectEvidence(capabilityContext);
  let result = await (capability.buildReadResponse ? capability.buildReadResponse(capabilityContext, evidence) : { status: "unsupported" as const, answer: "" });
  result = enforceReadResultRespectsEvidence({ capability, result: result as DomainResult, evidence, tracer });
  let response = capabilityDomainResultToConversationResponse({ context: capabilityContext, capability, result: result as DomainResult, evidence });
  response.execution = {
    ...(response.execution || {}),
    orchestrator_v2: {
      request_id: tracer.requestId,
      correlation_id: tracer.correlationId,
      runtime_id: tracer.runtimeId,
      followup: { detected: true, reference_type: "temporal_followup", source_domain: resultSet.domain, resolution_status: "resolved", fallback_used: false },
    },
  };
  response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, capability);
  tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
  return response;
}

// Bounded to utilities.spending.read per the programme's explicit priority
// ("at least real utility financial comparison works"). Re-invokes the same
// capability twice with synthetic, complementary period phrasing and diffs
// the two evidence sets — this is real evidence-backed comparison, not
// forecasting.
function complementaryPeriodPhrasing(mode: string | undefined): { current: string; previous: string } | null {
  if (mode === "this_week" || mode === "last_week") return { current: "this week", previous: "last week" };
  if (mode === "custom" || mode === "last_month") return { current: "this month", previous: "last month" };
  return null;
}

async function handleUtilityComparisonFollowUp(context: CanonicalConversationRequestContext, resolvedTurn: ResolvedTurn, resultSet: ResultSetContext, tracer: ConversationTracer): Promise<ConversationRunResult | null> {
  if (resultSet.domain !== "utilities") return null;
  const capability = capabilityRegistry.get("utilities.spending.read");
  if (!capability) return null;
  const pair = complementaryPeriodPhrasing(resultSet.timeframe?.mode);
  if (!pair) return null;
  const currentContext = { ...context, input: { ...context.input, message: `What did I spend on utilities ${pair.current}?` }, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "followup_comparison") };
  const previousContext = { ...context, input: { ...context.input, message: `What did I spend on utilities ${pair.previous}?` }, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "followup_comparison") };
  const [currentEvidence, previousEvidence] = await Promise.all([
    capability.collectEvidence(currentContext),
    capability.collectEvidence(previousContext),
  ]);
  const currentFacts = currentEvidence.map((item) => recordOf(item.payload).fact).filter((f): f is IntelligenceFact => Boolean(f));
  const previousFacts = previousEvidence.map((item) => recordOf(item.payload).fact).filter((f): f is IntelligenceFact => Boolean(f));
  const evidenceUnavailable = currentFacts.some((f) => f.truth_state === "unavailable") || previousFacts.some((f) => f.truth_state === "unavailable");
  const answer = evidenceUnavailable
    ? "Utility spending evidence is unavailable for one of the two periods right now, so I cannot compare them safely."
    : buildUtilitySpendingComparisonAnswer(currentFacts, previousFacts);
  const result: DomainResult = {
    status: evidenceUnavailable ? "unavailable" : (currentFacts.length || previousFacts.length) ? "answered" : "empty",
    answer,
    presentation_policy: NO_ACTIONS_TEXT_PRESENTATION,
    metadata: {
      comparison_metric: "utility_spending",
      period_a: pair.previous,
      period_b: pair.current,
      evidence_count: currentFacts.length + previousFacts.length,
      comparison_status: evidenceUnavailable ? "unavailable" : "compared",
    },
  };
  let response = capabilityDomainResultToConversationResponse({ context: currentContext, capability, result, evidence: [...currentEvidence, ...previousEvidence] });
  response.execution = {
    ...(response.execution || {}),
    orchestrator_v2: {
      request_id: tracer.requestId,
      correlation_id: tracer.correlationId,
      runtime_id: tracer.runtimeId,
      followup: { detected: true, reference_type: "comparison", source_domain: resultSet.domain, resolution_status: evidenceUnavailable ? "unavailable" : "resolved" },
    },
  };
  response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, capability);
  tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
  return response;
}

// Entry point: tries to resolve the current turn as a follow-up against the
// PREVIOUS turn's persisted result set. Returns null (never throws) when
// there's no thread, no follow-up cue, no prior result set, or resolution
// fails — callers fall through to normal capability routing (the legacy
// per-domain ordinal branches in oyiUnifiedIntelligenceService.ts remain the
// eventual fallback for anything this generic resolver can't cover yet, per
// the strangler migration approach).
function followUpCapabilityFor(resultSet: ResultSetContext): CapabilityModule {
  const capability = resultSet.capability_key ? capabilityRegistry.get(resultSet.capability_key) : null;
  return capability || syntheticFollowUpCapability(resultSet.domain);
}

async function buildAmbiguousFollowUpResponse(context: CanonicalConversationRequestContext, resolvedTurn: ResolvedTurn, resultSet: ResultSetContext, referenceType: string, candidateRefs: import("../context/resultSetContext").ResultSetObjectRef[], tracer: ConversationTracer): Promise<ConversationRunResult> {
  const candidates = clarificationCandidatesFromRefs(candidateRefs);
  const names = candidates.map((c) => c.label).filter(Boolean).slice(0, 4).join("; ");
  const result: DomainResult = {
    status: "draft",
    answer: `I found more than one match — did you mean: ${names}? Please tell me which one.`,
    presentation_policy: NO_ACTIONS_TEXT_PRESENTATION,
    metadata: { followup_ambiguous: true, candidate_count: candidates.length },
  };
  const capabilityForAdapter = followUpCapabilityFor(resultSet);
  let response = capabilityDomainResultToConversationResponse({ context: { ...context, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "followup_resolution") }, capability: capabilityForAdapter, result, evidence: [] });
  response.execution = {
    ...(response.execution || {}),
    orchestrator_v2: {
      request_id: tracer.requestId,
      correlation_id: tracer.correlationId,
      runtime_id: tracer.runtimeId,
      followup: { detected: true, resolver: "canonical", reference_type: referenceType, source_domain: resultSet.domain, result_set_id: resultSet.result_set_id, candidate_count: candidates.length, resolution_status: "ambiguous" },
    },
  };
  response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, capabilityForAdapter);
  tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
  return response;
}

async function resolveAndHydrateSingleObject(context: CanonicalConversationRequestContext, resolvedTurn: ResolvedTurn, resultSet: ResultSetContext, intent: FollowUpIntent, ref: import("../context/resultSetContext").ResultSetObjectRef, tracer: ConversationTracer): Promise<ConversationRunResult> {
  const capabilityForAdapter = followUpCapabilityFor(resultSet);
  // Phase 4, PR 3 -- office_* result sets have no hydrateCanonicalTarget
  // path (Backend has no DB connection to Office's tables); answer
  // directly from the ref's own already-persisted label/status/
  // attributes instead of re-fetching. See officeResultSetReference.ts.
  if (isOfficeResultSetDomain(resultSet.domain, resultSet.capability_key)) {
    const fact = officeFactFromRef(ref, resultSet.domain);
    const result: DomainResult = {
      status: "answered",
      answer: officeFollowUpAnswer(ref, intent),
      presentation_policy: NO_ACTIONS_TEXT_PRESENTATION,
    };
    let officeResponse = capabilityDomainResultToConversationResponse({
      context: { ...context, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "followup_resolution") },
      capability: capabilityForAdapter,
      result,
      evidence: [evidenceFromFollowUpFact(fact)],
    });
    officeResponse.facts = [fact];
    officeResponse.result_set = narrowedResultSetContext(resultSet, ref, {
      contract: { conversation_request_id: resolvedTurn.request_id, thread_id: context.input.thread_id || null, temporal_scope: resultSet.timeframe || { mode: "current", from: null, to: null } },
      message: context.input.message,
    }) as unknown as Record<string, unknown>;
    officeResponse.execution = {
      ...(officeResponse.execution || {}),
      orchestrator_v2: {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        runtime_id: tracer.runtimeId,
        followup: { detected: true, resolver: "office_result_set", reference_type: intent.type, source_domain: resultSet.domain, result_set_id: resultSet.result_set_id, resolution_status: "resolved", resolved_object_ref: ref.canonical_id, resolved_object_type: ref.object_type },
      },
    };
    officeResponse = await persistCapabilityResponse(context, officeResponse, officeResponse.truth, resolvedTurn, capabilityForAdapter);
    tracer.finish({ thread_id: officeResponse.thread_id || null, response_state: officeResponse.persistence_saved === false ? "unsaved" : "returned" });
    return officeResponse;
  }
  const hydration = await hydrateCanonicalTarget({
    actor: context.actor,
    oisContext: context.oisContext,
    target: {
      objectType: ref.object_type,
      objectId: ref.canonical_id,
      objectName: ref.label,
      source: "thread_target",
      confidence: 0.9,
      ambiguous: false,
      clarificationQuestion: null,
    },
    activeContext: null,
    visibleState: null,
  });
  const fact = factFromHydration(hydration);
  const result: DomainResult = {
    status: fact ? "answered" : "unavailable",
    answer: fact ? followUpDetailAnswer(hydration, intent, fact) : "I could not confirm that item right now, so I am not answering as confirmed.",
    presentation_policy: NO_ACTIONS_TEXT_PRESENTATION,
  };
  const evidence = fact ? [evidenceFromFollowUpFact(fact)] : [];
  let response = capabilityDomainResultToConversationResponse({ context: { ...context, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "followup_resolution") }, capability: capabilityForAdapter, result, evidence });
  if (fact) {
    response.facts = [fact];
    response.result_set = narrowedResultSetContext(resultSet, ref, {
      contract: { conversation_request_id: resolvedTurn.request_id, thread_id: context.input.thread_id || null, temporal_scope: resultSet.timeframe || { mode: "current", from: null, to: null } },
      message: context.input.message,
    }) as unknown as Record<string, unknown>;
  }
  response.execution = {
    ...(response.execution || {}),
    orchestrator_v2: {
      request_id: tracer.requestId,
      correlation_id: tracer.correlationId,
      runtime_id: tracer.runtimeId,
      followup: { detected: true, resolver: "canonical", reference_type: intent.type, source_domain: resultSet.domain, result_set_id: resultSet.result_set_id, resolution_status: fact ? "resolved" : "unavailable", resolved_object_ref: ref.canonical_id, resolved_object_type: ref.object_type, hydration_status: hydration.status },
    },
  };
  response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, capabilityForAdapter);
  tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
  return response;
}

// Filter continuity: "show only the high priority ones" narrows the
// previous list to the matching subset (possibly more than one item) and
// presents it directly from the already-persisted object_refs — no new
// query, no per-domain filter logic.
async function handleFilterFollowUp(context: CanonicalConversationRequestContext, resolvedTurn: ResolvedTurn, resultSet: ResultSetContext, keyword: string, tracer: ConversationTracer): Promise<ConversationRunResult | null> {
  const resolution = resolveFilterFollowUp(resultSet, keyword);
  if (resolution.status === "unresolved") return null;
  const capabilityForAdapter = followUpCapabilityFor(resultSet);
  const labels = resolution.matched.slice(0, 5).map((ref) => ref.label).filter(Boolean).join("; ");
  const result: DomainResult = {
    status: "answered",
    answer: `${resolution.matched.length} of ${resultSet.object_refs.length} match "${keyword}": ${labels}.`,
    presentation_policy: NO_ACTIONS_TEXT_PRESENTATION,
  };
  let response = capabilityDomainResultToConversationResponse({ context: { ...context, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "followup_resolution") }, capability: capabilityForAdapter, result, evidence: [] });
  response.result_set = filteredResultSetContext(resultSet, resolution.matched, "keyword", keyword, {
    contract: { conversation_request_id: resolvedTurn.request_id, thread_id: context.input.thread_id || null, temporal_scope: resultSet.timeframe || { mode: "current", from: null, to: null } },
    message: context.input.message,
  }) as unknown as Record<string, unknown>;
  response.execution = {
    ...(response.execution || {}),
    orchestrator_v2: {
      request_id: tracer.requestId,
      correlation_id: tracer.correlationId,
      runtime_id: tracer.runtimeId,
      followup: { detected: true, resolver: "canonical", reference_type: "filter", source_domain: resultSet.domain, result_set_id: resultSet.result_set_id, resolution_status: "resolved", candidate_count: resolution.matched.length },
    },
  };
  response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, capabilityForAdapter);
  tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
  return response;
}

// "Go back to that maintenance issue" — restores focus to a DIFFERENT
// domain's own persisted result set (not the currently active one). See
// §10 of the closure spec: cross-domain context switching. Only resolves
// when the referenced domain actually has a stored result set in this
// thread; otherwise falls through so normal routing can still try.
async function handleDomainSwitchFollowUp(context: CanonicalConversationRequestContext, resolvedTurn: ResolvedTurn, switchIntent: Extract<ReturnType<typeof parseDomainSwitchIntent>, { type: "switch" } | { type: "ambiguous" }>, tracer: ConversationTracer): Promise<ConversationRunResult | null> {
  const { resultSets } = await loadThreadResultSetsContext(context.input.thread_id);
  const availableDomains = Object.keys(resultSets);
  if (switchIntent.type === "ambiguous") {
    if (!availableDomains.length) return null;
    if (availableDomains.length === 1) {
      // Only one domain on record — safe to resolve directly, no real ambiguity.
      return resolveAndHydrateSingleObject(context, resolvedTurn, resultSets[availableDomains[0]], { type: "pronoun" }, resultSets[availableDomains[0]].selected_object_ref || resultSets[availableDomains[0]].object_refs[0], tracer);
    }
    const capabilityForAdapter = syntheticFollowUpCapability("global");
    const result: DomainResult = {
      status: "draft",
      answer: `I have more than one earlier topic in this conversation — did you mean ${availableDomains.join(", ")}? Please name the one you mean.`,
      presentation_policy: NO_ACTIONS_TEXT_PRESENTATION,
      metadata: { followup_ambiguous: true, candidate_count: availableDomains.length },
    };
    let response = capabilityDomainResultToConversationResponse({ context: { ...context, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "followup_resolution") }, capability: capabilityForAdapter, result, evidence: [] });
    response.execution = {
      ...(response.execution || {}),
      orchestrator_v2: { request_id: tracer.requestId, correlation_id: tracer.correlationId, runtime_id: tracer.runtimeId, followup: { detected: true, resolver: "canonical", reference_type: "domain_switch", resolution_status: "ambiguous", candidate_count: availableDomains.length } },
    };
    response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, capabilityForAdapter);
    tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
    return response;
  }
  const targetResultSet = resultSets[switchIntent.domain];
  if (!targetResultSet) return null;
  const resolution = resolveFollowUpReference(targetResultSet, { type: "pronoun" });
  if (resolution.status === "ambiguous") return buildAmbiguousFollowUpResponse(context, resolvedTurn, targetResultSet, "domain_switch", resolution.candidates, tracer);
  if (resolution.status === "unresolved") return null;
  return resolveAndHydrateSingleObject(context, resolvedTurn, targetResultSet, { type: "pronoun" }, resolution.ref, tracer);
}

async function attemptFollowUpResolution(context: CanonicalConversationRequestContext, resolvedTurn: ResolvedTurn, tracer: ConversationTracer): Promise<ConversationRunResult | null> {
  if (resolvedTurn.target) return null;
  if (!context.input.thread_id) return null;

  const switchIntent = parseDomainSwitchIntent(context.input.message);
  if (switchIntent) {
    const switched = await handleDomainSwitchFollowUp(context, resolvedTurn, switchIntent, tracer);
    if (switched) return switched;
    // Fall through to normal follow-up/routing if the referenced domain
    // has no stored result set to restore.
  }

  const intent = parseFollowUpIntent(context.input.message);
  if (!intent) return null;
  const resultSet = await loadThreadResultSetContext(context.input.thread_id);
  logger.info("oyi_followup_detected", {
    request_id: tracer.requestId,
    correlation_id: tracer.correlationId,
    thread_id: context.input.thread_id,
    resolver: resultSet ? "canonical" : "none",
    reference_type: intent.type,
    source_turn: resultSet?.source_request_id || null,
    result_set_id: resultSet?.result_set_id || null,
    source_domain: resultSet?.domain || null,
    candidate_count: resultSet?.object_refs.length || 0,
    fallback_used: !resultSet,
  });
  if (!resultSet) return null;

  // Milestone 2 -- production bug found in live verification: "pause
  // the second one" / "move the first one to 3pm" parse as a genuine
  // ordinal FOLLOW-UP reference (parseFollowUpIntent, above) against
  // the active list's domain, and this function runs BEFORE normal
  // capability routing -- so it was answering these as a read-only
  // "tell me about it" lookup instead of ever reaching office_X.write's
  // batch/ordinal proposal path. Exact same collision class as
  // Milestone 1's "the first two" bug, just for the singular ordinal
  // case Tasks' own batch flow never exercised (single-record Task
  // mutations always said "move THIS to...", never "the first one").
  // If the message is ALSO a genuine mutation for the result set's own
  // domain, defer entirely to normal capability routing -- an ordinary
  // read follow-up ("tell me about the first one") never matches any
  // domain's mutation parser, so this changes nothing for reads.
  const domainMutationParser = REVISION_DOMAIN_INTENT_PARSER[resultSet.domain];
  if (domainMutationParser && domainMutationParser(context.input.message, "")) {
    return null;
  }

  if (intent.type === "comparison") return handleUtilityComparisonFollowUp(context, resolvedTurn, resultSet, tracer);
  if (intent.type === "temporal_followup") return handleTemporalFollowUp(context, resolvedTurn, resultSet, tracer);
  if (intent.type === "filter") return handleFilterFollowUp(context, resolvedTurn, resultSet, intent.keyword, tracer);

  const resolution = resolveFollowUpReference(resultSet, intent);
  if (resolution.status === "unresolved") return null;
  if (resolution.status === "ambiguous") return buildAmbiguousFollowUpResponse(context, resolvedTurn, resultSet, intent.type, resolution.candidates, tracer);
  return resolveAndHydrateSingleObject(context, resolvedTurn, resultSet, intent, resolution.ref, tracer);
}

const BUSINESS_CAPABILITY_LABELS: Record<string, string> = {
  "crm.leads.read": "leads that need attention",
  "crm.opportunities.read": "opportunities that haven't been followed up",
  "reports.approvals.read": "reports awaiting approval",
  "development.status.read": "development project status",
  "financial.summary.read": "financial position",
  "office_tasks.read": "the task you have open",
  "office_automations.read": "the automation you have open",
  "office_meetings.read": "the meeting you have open",
  "office_support.read": "the support case you have open",
  "office_portfolio.read": "the portfolio entry you have open",
  "office_partnerships.read": "the partnership you have open",
  "office_documents.read": "the document you have open",
  "office_content.read": "the article you have open",
  "corporate.company.read": "what Ochiga does",
  "corporate.development.read": "Ochiga's current developments",
  "corporate.oyi.read": "what Oyi is",
  "corporate.private.read": "Ochiga Private",
  "corporate.partnerships.read": "partnering with Ochiga",
};

const OFFICE_OVERVIEW_CAPABILITY_KEYS = ["crm.leads.read", "crm.opportunities.read", "reports.approvals.read", "development.status.read", "financial.summary.read"];

function unavailableInsideFallback(): Promise<ConversationRunResult> {
  return Promise.reject(new Error("legacyFallback is not available inside the business-surface fallback response"));
}

// office_internal/public_corporate have no legacy engine of their own —
// this composes an honest response directly from the real capabilities
// registered for the surface instead of ever reaching
// legacyConversationAdapter.run() (Consumer/Facility's device/room
// target resolver), which has no notion of a CRM lead or a corporate
// topic and previously surfaced its generic "Which item should I
// inspect?" clarification for every business question on these
// surfaces. Only used when no single capability resolved a match, so
// this never overrides a real capability answer or a genuine
// permission denial.
async function collectBusinessOverviewSections(
  baseContext: CanonicalConversationRequestContext & { resolvedTurn: ResolvedTurn },
  keys: string[]
): Promise<Array<{ key: string; result: DomainResult; evidence: OyiEvidence[] }>> {
  const surface = baseContext.input.surface;
  const sections: Array<{ key: string; result: DomainResult; evidence: OyiEvidence[] }> = [];
  for (const key of keys) {
    const capability = capabilityRegistry.get(key);
    if (!capability) continue;
    const authority = capabilityService.canUse(key, { actor: baseContext.actor, oisContext: baseContext.oisContext, surface });
    if (!authority.allowed) continue;
    const capabilityContext: CapabilityContext = { ...baseContext, legacyFallback: unavailableInsideFallback };
    try {
      const evidence = await capability.collectEvidence(capabilityContext);
      const result = capability.buildReadResponse ? await capability.buildReadResponse(capabilityContext, evidence) as DomainResult : null;
      if (result && result.status === "answered") sections.push({ key, result, evidence });
    } catch (error) {
      logger.warn("oyi_business_fallback_section_failed", {
        capability_key: key,
        surface,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return sections;
}

async function buildBusinessSurfaceFallbackResponse(
  baseContext: CanonicalConversationRequestContext & { resolvedTurn: ResolvedTurn }
): Promise<ConversationRunResult> {
  const surface = baseContext.input.surface;
  const frame = baseContext.resolvedTurn.semantic_frame;
  const listing = capabilityService
    .listForActor({ actor: baseContext.actor, oisContext: baseContext.oisContext, surface })
    .filter((item) => item.key !== "global.capabilities.read");
  const isOverviewQuery = surface === "office_internal" && /\battention|happening|overview|update\b/i.test(frame.normalizedText);

  let sections: Array<{ key: string; result: DomainResult; evidence: OyiEvidence[] }> = [];
  if (isOverviewQuery) {
    const keys = OFFICE_OVERVIEW_CAPABILITY_KEYS.filter((key) => listing.some((item) => item.key === key));
    sections = await collectBusinessOverviewSections(baseContext, keys);
  }

  let answer: string;
  let blocks: Array<Record<string, unknown>> = [];
  if (sections.length) {
    answer = sections.map((section) => `${BUSINESS_CAPABILITY_LABELS[section.key] || section.key}:\n${section.result.answer}`).join("\n\n");
    blocks = sections.flatMap((section) => section.result.blocks || []);
  } else if (listing.length) {
    const topics = listing.map((item) => BUSINESS_CAPABILITY_LABELS[item.key] || item.key.replace(/\./g, " "));
    answer = surface === "office_internal"
      ? `I can help with ${topics.join(", ")}. Ask me about any of these directly and I'll pull the current data.`
      : `I can tell you about ${topics.join(", ")}. Ask me about any of these.`;
  } else {
    answer = "I don't have an enabled capability for that yet on this surface.";
  }

  const syntheticCapability: CapabilityModule = {
    key: "business_surface.fallback",
    domain: "global",
    rolloutStatus: "enabled",
    supported_surfaces: [surface],
    supports: () => true,
    resolve: async () => ({ supported: true, reason: null }),
    collectEvidence: async () => [],
  };
  const result: DomainResult = {
    status: sections.length || listing.length ? "answered" : "unsupported",
    answer,
    blocks,
    presentation_policy: resultPresentation(sections.length ? "list" : "text"),
  };
  const capabilityContext: CapabilityContext = { ...baseContext, legacyFallback: unavailableInsideFallback };
  return capabilityDomainResultToConversationResponse({
    context: capabilityContext,
    capability: syntheticCapability,
    result,
    evidence: sections.flatMap((section) => section.evidence),
  });
}

export class ConversationOrchestrator {
  async run(context: CanonicalConversationRequestContext): Promise<ConversationRunResult> {
    ensureRegistered();
    const frame = parseSemanticFrame(context.input.message);
    const tracer = new ConversationTracer({
      requestId: String((context.input.context as any)?.request_id || "") || undefined,
      correlationId: String((context.input.context as any)?.correlation_id || "") || undefined,
    });
    tracer.stage("request_received", { surface: context.input.surface, thread_id: context.input.thread_id || null });
    tracer.stage("turn_normalized", { domain: frame.domain, operation: frame.operation, correction_count: frame.corrections.length });
    if (isDeviceActionFrame(frame)) {
      deviceActionOrchestratorTrace("oyi_device_action_workflow_restore_started", context, null, tracer, {
        semantic_operation: frame.operation,
      });
    }
    const referencedWorkflowId = explicitWorkflowReference(context);
    let activeWorkflow = await workflowService.restoreActive({ threadId: context.input.thread_id || null, actorId: context.actor?.id || null }).catch((error) => {
      logger.warn("oyi_workflow_restore_failed", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: context.input.thread_id || null,
        actor_id: context.actor?.id || null,
        failure_stage: "workflow_restore",
        error_class: safeErrorClass(error),
        safe_error_code: safeErrorCode(error),
        error: (error as any)?.message || String(error),
      });
      return null;
    });
    let workflowRestoreStrategy = activeWorkflow ? "thread" : "none";
    if (!activeWorkflow && referencedWorkflowId && context.input.thread_id) {
      activeWorkflow = await workflowService.restoreReferenced({
        workflowId: referencedWorkflowId,
        threadId: context.input.thread_id,
        actorId: context.actor?.id || null,
        surface: context.input.surface,
        estateId: context.input.estate_id || context.oisContext?.estate_id || null,
        homeId: context.input.home_id || context.oisContext?.home_id || null,
      }).catch((error) => {
        logger.warn("oyi_workflow_restore_failed", {
          request_id: tracer.requestId,
          correlation_id: tracer.correlationId,
          thread_id: context.input.thread_id || null,
          actor_id: context.actor?.id || null,
          workflow_id: referencedWorkflowId,
          failure_stage: "workflow_reference_restore",
          error_class: safeErrorClass(error),
          safe_error_code: safeErrorCode(error),
          error: (error as any)?.message || String(error),
        });
        return null;
      });
      workflowRestoreStrategy = activeWorkflow ? "explicit_workflow_reference" : "none";
    }
    if (isDeviceActionFrame(frame) || activeWorkflow?.capability_key === "devices.power.control") {
      deviceActionOrchestratorTrace("oyi_device_action_workflow_restored", context, null, tracer, {
        semantic_operation: frame.operation,
        workflow_id: activeWorkflow?.workflow_id || null,
        workflow_status: activeWorkflow?.status || "not_restored",
        restore_strategy: workflowRestoreStrategy,
      });
    }
    tracer.stage("workflow_restored", { workflow_id: activeWorkflow?.workflow_id || null, status: activeWorkflow?.status || "not_restored" });
    let resolvedTurn = resolveTurnAuthority({
      actor: context.actor,
      oisContext: context.oisContext,
      request: context.input,
      frame,
      activeWorkflowId: activeWorkflow?.workflow_id || null,
      requestId: tracer.requestId,
      correlationId: tracer.correlationId,
      runtimeId: tracer.runtimeId,
    });
    // Oyi Conversational Runtime Completion Programme, Phase 2 -- office_
    // internal conversation continuity. A no-op for every other surface
    // (returns the same objects back). See officeConversationContext.ts
    // for the full precedence rules; this only ever adjusts the DOMAIN
    // classification and/or reinjects a previously-sent *_context slot --
    // it never changes authority/permissions, which capabilityService.
    // canUse() still checks fresh against the CURRENT actor below.
    const continuity = await resolveOfficeConversationContinuity(context, resolvedTurn);
    if (continuity.source !== "unchanged") {
      logger.info("oyi_office_continuity_applied", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: context.input.thread_id || null,
        actor_id: context.actor?.id || null,
        raw_domain: resolvedTurn.domain,
        resolved_domain: continuity.resolvedTurn.domain,
        source: continuity.source,
      });
    }
    context = continuity.context;
    resolvedTurn = continuity.resolvedTurn;
    tracer.stage("turn_resolved", {
      domain: resolvedTurn.domain,
      operation: resolvedTurn.operation,
      capability_key: resolvedTurn.capability_key,
      target_type: resolvedTurn.target?.object_type || null,
      target_source: resolvedTurn.target_source,
    });
    tracer.stage("authority_decided", {
      domain: resolvedTurn.domain,
      operation: resolvedTurn.operation,
      authority_result: resolvedTurn.authority.allowed ? "allowed" : "denied",
      tier: resolvedTurn.authority.tier,
    });
    if (activeWorkflow) {
      const workflowCapability = capabilityRegistry.get(activeWorkflow.capability_key);
      if (workflowCapability) {
        let continuation: DomainResult | null = null;
        const workflowContext = { ...context, resolvedTurn, legacyFallback: () => legacyConversationAdapter.run(context.actor, context.oisContext, context.input, "durable_workflow_continuation") };
        if (isConfirmationText(context.input.message) || isCancellationText(context.input.message)) {
          continuation = await durableWorkflowContinuationResult(context, activeWorkflow, workflowCapability);
        } else if (activeWorkflow.status === "awaiting_clarification") {
          continuation = await continueDeviceActionWorkflow(workflowContext, activeWorkflow);
        } else if (isContinueText(context.input.message)) {
          continuation = await pendingWorkflowStatusResult(activeWorkflow);
        }
        if (continuation) {
          let response = capabilityDomainResultToConversationResponse({
            context: workflowContext,
            capability: workflowCapability,
            result: continuation,
            evidence: [],
          });
          response.execution = {
            ...(response.execution || {}),
            orchestrator_v2: {
              request_id: tracer.requestId,
              correlation_id: tracer.correlationId,
              runtime_id: tracer.runtimeId,
              semantic_frame: frame,
              resolved_turn: resolvedTurn,
              capability_key: workflowCapability.key,
              capability_rollout_status: workflowCapability.rolloutStatus,
              capability_authority: null,
              legacy_fallback_used: false,
            },
          };
          response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, workflowCapability);
          tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
          return response;
        }
      }
    }
    // Oyi Conversational Runtime Completion Programme, Phase 3 -- a
    // pending/confirmed governed action proposal (office_internal only)
    // is checked next, same precedence tier as the device-workflow
    // confirmation block above it (a separate mechanism -- see
    // officeActionProposal.ts). Returns null when there's nothing to
    // handle, structurally a no-op for every other surface.
    const officeActionResponse = await handleOfficeActionProposalTurn(context, resolvedTurn, tracer).catch((error) => {
      logger.warn("oyi_office_action_proposal_turn_failed", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: context.input.thread_id || null,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (officeActionResponse) {
      tracer.finish({ thread_id: officeActionResponse.thread_id || null, response_state: officeActionResponse.persistence_saved === false ? "unsaved" : "returned" });
      return officeActionResponse;
    }
    // Generic follow-up resolution runs before normal capability routing —
    // a pending device-action confirmation (handled above) always wins, but
    // an ordinal/pronoun/temporal follow-up against the previous turn's
    // result set is tried next, before falling through to fresh semantic
    // routing. Returns null (never throws) when there's nothing to resolve.
    const followUpResponse = await attemptFollowUpResolution(context, resolvedTurn, tracer).catch((error) => {
      logger.warn("oyi_followup_resolution_failed", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: context.input.thread_id || null,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    if (followUpResponse) return followUpResponse;
    const selection = boolFlag("OYI_ORCHESTRATOR_V2_ENABLED", true)
      ? capabilityService.resolve({ ...context, resolvedTurn })
      : { capability: null, matched_capability: null, rollout_status: "disabled" as const, authority: null, legacy_fallback_reason: "orchestrator_v2_disabled" };
    // office_internal/public_corporate have no capability module for
    // every domain a Consumer/Facility module claims (e.g. "home"), so
    // resolve() can still pick a Consumer/Facility-only module as the
    // single top-scoring candidate. That candidate is always denied here
    // with reason "surface_not_supported" — an architectural mismatch,
    // not a real permission problem — so it's folded into "no capability
    // matched" rather than surfaced as "You are not authorised...".
    // A genuine RBAC denial (missing_permission) is untouched and still
    // reported as a real denial below.
    const isBusinessSurface = context.input.surface === "office_internal" || context.input.surface === "public_corporate";
    const architecturalMismatch = isBusinessSurface && Boolean(selection.authority) && !selection.authority!.allowed && selection.authority!.reason === "surface_not_supported";
    const capability = architecturalMismatch ? null : selection.capability;
    const matchedCapability = architecturalMismatch ? null : selection.matched_capability;
    logger.info("oyi_capability_resolved", {
      request_id: tracer.requestId,
      correlation_id: tracer.correlationId,
      thread_id: context.input.thread_id || null,
      actor_id: context.actor?.id || null,
      surface: context.input.surface,
      capability_key: capability?.key || matchedCapability?.key || null,
      domain: resolvedTurn.domain,
      rollout_status: selection.rollout_status,
      target_type: resolvedTurn.target?.object_type || null,
      authority_allowed: selection.authority?.allowed ?? null,
      legacy_fallback_reason: selection.legacy_fallback_reason,
    });
    tracer.stage("capability_selected", {
      domain: resolvedTurn.domain,
      operation: resolvedTurn.operation,
      capability_key: capability?.key || matchedCapability?.key || "legacy",
      rollout_status: selection.rollout_status || "legacy_fallback",
    });

    const legacyFallback = async () => {
      const reason = architecturalMismatch ? "capability_surface_mismatch" : selection.legacy_fallback_reason || "unimplemented_capability";
      if (isBusinessSurface) {
        // Never reach legacyConversationAdapter.run() — Consumer/
        // Facility's device/room target resolver — for these two
        // surfaces. It has no notion of a CRM lead, a report or a
        // corporate topic, so every unmatched query used to fall into
        // its generic "Which item should I inspect?" clarification.
        tracer.stage("legacy_fallback_used", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, reason, fallback_owner: "business_surface_fallback" });
        logger.info("oyi_business_surface_fallback", {
          request_id: tracer.requestId,
          correlation_id: tracer.correlationId,
          thread_id: context.input.thread_id || null,
          actor_id: context.actor?.id || null,
          surface: context.input.surface,
          domain: resolvedTurn.domain,
          legacy_fallback_reason: reason,
          fallback_owner: "business_surface_fallback",
        });
        return buildBusinessSurfaceFallbackResponse({ ...context, resolvedTurn });
      }
      tracer.stage("legacy_fallback_used", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, reason });
      logger.info("oyi_capability_legacy_fallback", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: context.input.thread_id || null,
        actor_id: context.actor?.id || null,
        surface: context.input.surface,
        capability_key: capability?.key || matchedCapability?.key || null,
        domain: resolvedTurn.domain,
        rollout_status: selection.rollout_status,
        target_type: resolvedTurn.target?.object_type || null,
        legacy_fallback_reason: reason,
        fallback_owner: "legacy_conversation_adapter",
      });
      return legacyConversationAdapter.run(context.actor, context.oisContext, context.input, reason);
    };

    let response: ConversationRunResult;
    let capabilityOwnsResponse: CapabilityModule | null = null;
    if (capability) {
      const capabilityContext = { ...context, resolvedTurn, legacyFallback };
      if (capability.key === "devices.power.control") {
        deviceActionOrchestratorTrace("oyi_device_action_capability_resolved", context, resolvedTurn, tracer, {
          rollout_status: capability.rolloutStatus,
          authority_allowed: selection.authority?.allowed ?? null,
          target_type: resolvedTurn.target?.object_type || null,
          target_id: resolvedTurn.target?.canonical_id || null,
          target_label: resolvedTurn.target?.label || null,
          channel_code: resolvedTurn.target?.channel_code || null,
        });
      }
      if (selection.authority && !selection.authority.allowed) {
        const result: DomainResult = {
          status: "permission_restricted",
          answer: "You are not authorised to use that Oyi capability from this surface or scope.",
          presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
          metadata: { reason: selection.authority.reason, required_permissions: selection.authority.required_permissions },
        };
        response = capabilityDomainResultToConversationResponse({ context: capabilityContext, capability, result, evidence: [] });
        capabilityOwnsResponse = capability;
      } else {
        const resolution = await capability.resolve(capabilityContext);
        if (resolution.supported && capability.buildReadResponse) {
          tracer.stage("evidence_planned", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, capability_key: capability.key });
          const evidence = await capability.collectEvidence(capabilityContext);
          const evidenceAuthority = capabilityService.assertEvidenceAllowed(capability, evidence, {
            actor: context.actor,
            oisContext: context.oisContext,
            surface: context.input.surface,
            scope: selection.authority?.scope || resolvedTurn.scope,
          });
          tracer.stage("evidence_loaded", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, capability_key: capability.key, evidence_count: evidence.length });
          logger.info("oyi_capability_evidence_loaded", {
            request_id: tracer.requestId,
            correlation_id: tracer.correlationId,
            thread_id: context.input.thread_id || null,
            actor_id: context.actor?.id || null,
            surface: context.input.surface,
            capability_key: capability.key,
            domain: capability.domain,
            rollout_status: capability.rolloutStatus,
            target_type: resolvedTurn.target?.object_type || null,
            authority_allowed: evidenceAuthority.allowed,
            evidence_count: evidence.length,
            reason: evidenceAuthority.reason,
          });
          let result = evidenceAuthority.allowed
            ? capability.key === "global.capabilities.read"
              ? buildCapabilityAdvertisingResult({ service: capabilityService, context })
              : await capability.buildReadResponse(capabilityContext, evidence) as DomainResult
            : {
              status: "permission_restricted",
              answer: "The evidence for that capability is restricted for this surface or scope.",
              presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
              metadata: { reason: evidenceAuthority.reason },
            } as DomainResult;
          if (evidenceAuthority.allowed && capability.key !== "global.capabilities.read") {
            result = enforceReadResultRespectsEvidence({ capability, result, evidence, tracer });
          }
          response = capabilityDomainResultToConversationResponse({ context: capabilityContext, capability, result, evidence });
          capabilityOwnsResponse = capability;
          logger.info("oyi_capability_handler_completed", {
            request_id: tracer.requestId,
            correlation_id: tracer.correlationId,
            thread_id: context.input.thread_id || null,
            actor_id: context.actor?.id || null,
            surface: context.input.surface,
            capability_key: capability.key,
            domain: capability.domain,
            rollout_status: capability.rolloutStatus,
            target_type: resolvedTurn.target?.object_type || null,
            evidence_count: evidence.length,
            result_type: result.status,
          });
        } else if (resolution.supported && capability.createDraft) {
          let draft: DomainResult | ConversationRunResult;
          try {
            draft = await capability.createDraft(capabilityContext);
          } catch (error) {
            logger.error("oyi_device_action_request_failed", {
              request_id: tracer.requestId,
              correlation_id: tracer.correlationId,
              thread_id: context.input.thread_id || null,
              actor_id: context.actor?.id || null,
              surface: context.input.surface,
              semantic_operation: resolvedTurn.semantic_frame.operation,
              capability_key: capability.key,
              target_type: resolvedTurn.target?.object_type || null,
              target_id: resolvedTurn.target?.canonical_id || null,
              target_label: resolvedTurn.target?.label || null,
              channel_code: resolvedTurn.target?.channel_code || null,
              failure_stage: "action_preparation",
              error_class: safeErrorClass(error),
              safe_error_code: safeErrorCode(error),
              error_message: (error as any)?.message || String(error),
            });
            const result: DomainResult = {
              status: "unavailable",
              answer: "I could not safely prepare that device command. I did not send any command.",
              presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
              metadata: { failure_stage: "action_preparation", safe_error_code: safeErrorCode(error) },
            };
            draft = result;
          }
          response = typeof (draft as any).answer === "string" && !(draft as any).reply
            ? capabilityDomainResultToConversationResponse({ context: capabilityContext, capability, result: draft as DomainResult, evidence: [] })
            : draft as ConversationRunResult;
          capabilityOwnsResponse = capability;
        } else {
          response = await legacyFallback();
        }
      }
    } else if (matchedCapability && selection.legacy_fallback_reason?.startsWith("capability_")) {
      const reason = selection.legacy_fallback_reason;
      logger.info("oyi_capability_not_enabled", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: context.input.thread_id || null,
        actor_id: context.actor?.id || null,
        surface: context.input.surface,
        capability_key: matchedCapability.key,
        domain: matchedCapability.domain,
        rollout_status: matchedCapability.rolloutStatus,
        fallback_reason: reason,
        fallback_owner: "canonical_capability_fallback",
      });
      logger.info("oyi_capability_legacy_fallback", {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        thread_id: context.input.thread_id || null,
        actor_id: context.actor?.id || null,
        surface: context.input.surface,
        capability_key: matchedCapability.key,
        domain: matchedCapability.domain,
        rollout_status: matchedCapability.rolloutStatus,
        target_type: resolvedTurn.target?.object_type || null,
        legacy_fallback_reason: reason,
        fallback_owner: "canonical_capability_fallback",
      });
      response = capabilityDomainResultToConversationResponse({
        context: { ...context, resolvedTurn, legacyFallback },
        capability: matchedCapability,
        result: nonEnabledCapabilityResult(matchedCapability, reason),
        evidence: [],
      });
      capabilityOwnsResponse = matchedCapability;
    } else {
      response = await legacyFallback();
    }

    try {
      assertNoUnverifiedGenericSuccess(response.answer || response.reply || response.message || "", Array.isArray(response.sources) ? response.sources.length : 0);
    } catch (error) {
      logger.warn("oyi_generic_success_firewall_blocked", { error, domain: resolvedTurn.domain, operation: resolvedTurn.operation });
      throw error;
    }
    response.execution = {
      ...(response.execution || {}),
      orchestrator_v2: {
        request_id: tracer.requestId,
        correlation_id: tracer.correlationId,
        runtime_id: tracer.runtimeId,
        semantic_frame: frame,
        resolved_turn: resolvedTurn,
        capability_key: capability?.key || matchedCapability?.key || "legacy",
        capability_rollout_status: selection.rollout_status,
        capability_authority: selection.authority,
        legacy_fallback_used: !capability || Boolean(selection.legacy_fallback_reason),
      },
    };
    if (capabilityOwnsResponse) {
      response = await persistCapabilityResponse(context, response, response.truth, resolvedTurn, capabilityOwnsResponse);
    }
    tracer.stage("response_composed", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, capability_key: capability?.key || matchedCapability?.key || "legacy" });
    tracer.stage("persistence_completed", { thread_id: response.thread_id || null, persistence_saved: response.persistence_saved === false ? "false" : "true" });
    tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
    return response;
  }
}

export const conversationOrchestrator = new ConversationOrchestrator();
