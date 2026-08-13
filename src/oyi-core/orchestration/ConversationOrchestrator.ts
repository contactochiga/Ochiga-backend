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
    const activeWorkflow = await workflowService.restoreActive({ threadId: context.input.thread_id || null, actorId: context.actor?.id || null }).catch((error) => {
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
    if (isDeviceActionFrame(frame) || activeWorkflow?.capability_key === "devices.power.control") {
      deviceActionOrchestratorTrace("oyi_device_action_workflow_restored", context, null, tracer, {
        semantic_operation: frame.operation,
        workflow_id: activeWorkflow?.workflow_id || null,
        workflow_status: activeWorkflow?.status || "not_restored",
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
          const result = evidenceAuthority.allowed
            ? capability.key === "global.capabilities.read"
              ? buildCapabilityAdvertisingResult({ service: capabilityService, context })
              : await capability.buildReadResponse(capabilityContext, evidence) as DomainResult
            : {
              status: "permission_restricted",
              answer: "The evidence for that capability is restricted for this surface or scope.",
              presentation_policy: { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
              metadata: { reason: evidenceAuthority.reason },
            } as DomainResult;
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
