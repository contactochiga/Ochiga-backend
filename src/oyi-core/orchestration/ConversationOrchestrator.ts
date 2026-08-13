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
import { buildPhaseBReadCapabilities } from "../capabilities/ReadCapabilityModules";
import type { CapabilityModule } from "../contracts/capability";
import { persistCanonicalConversationTurn } from "../persistence/canonicalConversationPersistence";
import { resolveTurnAuthority } from "./TurnAuthorityResolver";
import { assertNoUnverifiedGenericSuccess } from "../presentation/FallbackFirewall";
import { logger } from "../../observability/logger";

let registered = false;

function boolFlag(name: string, fallback = true) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !/^(0|false|off|disabled)$/i.test(String(value));
}

function ensureRegistered() {
  if (registered) return;
  for (const capability of buildPhaseBReadCapabilities()) capabilityRegistry.register(capability);
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
    tracer.stage("workflow_restored", { workflow_id: null, status: "not_restored" });
    const resolvedTurn = resolveTurnAuthority({
      actor: context.actor,
      oisContext: context.oisContext,
      request: context.input,
      frame,
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
          response = await capability.createDraft(capabilityContext) as ConversationRunResult;
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
