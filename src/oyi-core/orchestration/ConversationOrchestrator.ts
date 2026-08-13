import type { CanonicalConversationRequestContext, ConversationRunResult } from "../contracts/conversation";
import type { DomainResult } from "../contracts/domainResult";
import { parseSemanticFrame } from "../interpretation/SemanticFrameParser";
import { ConversationTracer } from "../observability/ConversationTracer";
import { legacyConversationAdapter } from "../legacy/LegacyConversationAdapter";
import { capabilityRegistry } from "../capabilities/CapabilityRegistry";
import { capabilityService } from "../capabilities/CapabilityService";
import { buildCapabilityAdvertisingResult } from "../capabilities/CapabilityAdvertisingPresentation";
import { capabilityDomainResultToConversationResponse } from "../capabilities/CapabilityResponseAdapter";
import { buildPhaseBReadCapabilities } from "../capabilities/ReadCapabilityModules";
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
      : { capability: null, rollout_status: "disabled" as const, authority: null, legacy_fallback_reason: "orchestrator_v2_disabled" };
    const capability = selection.capability;
    logger.info("oyi_capability_resolved", {
      request_id: tracer.requestId,
      correlation_id: tracer.correlationId,
      thread_id: context.input.thread_id || null,
      actor_id: context.actor?.id || null,
      surface: context.input.surface,
      capability_key: capability?.key || null,
      domain: resolvedTurn.domain,
      rollout_status: selection.rollout_status,
      target_type: resolvedTurn.target?.object_type || null,
      authority_allowed: selection.authority?.allowed ?? null,
      legacy_fallback_reason: selection.legacy_fallback_reason,
    });
    tracer.stage("capability_selected", {
      domain: resolvedTurn.domain,
      operation: resolvedTurn.operation,
      capability_key: capability?.key || "legacy",
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
        capability_key: capability?.key || null,
        domain: resolvedTurn.domain,
        rollout_status: selection.rollout_status,
        target_type: resolvedTurn.target?.object_type || null,
        legacy_fallback_reason: reason,
      });
      return legacyConversationAdapter.run(context.actor, context.oisContext, context.input, reason);
    };

    let response: ConversationRunResult;
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
        capability_key: capability?.key || "legacy",
        capability_rollout_status: selection.rollout_status,
        capability_authority: selection.authority,
        legacy_fallback_used: !capability || Boolean(selection.legacy_fallback_reason),
      },
    };
    tracer.stage("response_composed", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, capability_key: capability?.key || "legacy" });
    tracer.stage("persistence_completed", { thread_id: response.thread_id || null, persistence_saved: response.persistence_saved === false ? "false" : "true" });
    tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
    return response;
  }
}

export const conversationOrchestrator = new ConversationOrchestrator();
