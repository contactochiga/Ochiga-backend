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
import { buildPhaseBReadCapabilities } from "../capabilities/ReadCapabilityModules";
import type { CapabilityModule } from "../contracts/capability";
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
import { hydrateCanonicalTarget } from "../runtime/canonicalTargetHydrationRegistry";
import { buildExplainAnswer, buildStatusCheckAnswer, buildFieldAnswer } from "../domains/explainAnswer";
import { objectStateLine } from "../presentation/objectFallbackPresentation";
import { buildUtilitySpendingComparisonAnswer } from "../domains/utilities/utilityConversationAnswers";

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

  if (intent.type === "comparison") return handleUtilityComparisonFollowUp(context, resolvedTurn, resultSet, tracer);
  if (intent.type === "temporal_followup") return handleTemporalFollowUp(context, resolvedTurn, resultSet, tracer);
  if (intent.type === "filter") return handleFilterFollowUp(context, resolvedTurn, resultSet, intent.keyword, tracer);

  const resolution = resolveFollowUpReference(resultSet, intent);
  if (resolution.status === "unresolved") return null;
  if (resolution.status === "ambiguous") return buildAmbiguousFollowUpResponse(context, resolvedTurn, resultSet, intent.type, resolution.candidates, tracer);
  return resolveAndHydrateSingleObject(context, resolvedTurn, resultSet, intent, resolution.ref, tracer);
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
    const resolvedTurn = resolveTurnAuthority({
      actor: context.actor,
      oisContext: context.oisContext,
      request: context.input,
      frame,
      activeWorkflowId: activeWorkflow?.workflow_id || null,
      requestId: tracer.requestId,
      correlationId: tracer.correlationId,
      runtimeId: tracer.runtimeId,
    });
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
    const capability = selection.capability;
    const matchedCapability = selection.matched_capability;
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
      const reason = selection.legacy_fallback_reason || "unimplemented_capability";
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
