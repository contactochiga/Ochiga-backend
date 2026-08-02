import type { CanonicalConversationRequestContext, ConversationRunResult } from "../contracts/conversation";
import { parseSemanticFrame } from "../interpretation/SemanticFrameParser";
import { ConversationTracer } from "../observability/ConversationTracer";
import { legacyConversationAdapter } from "../legacy/LegacyConversationAdapter";
import { deviceDomainAdapter } from "../domains/devices/DeviceDomainAdapter";
import { capabilityRegistry } from "../capabilities/CapabilityRegistry";
import { resolveTurnAuthority } from "./TurnAuthorityResolver";
import { selectCapability } from "./CapabilityRouter";
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
  capabilityRegistry.register(deviceDomainAdapter);
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
    const capability = boolFlag("OYI_ORCHESTRATOR_V2_ENABLED", true) && boolFlag("OYI_DEVICE_ADAPTER_V2_ENABLED", true)
      ? selectCapability({ ...context, resolvedTurn })
      : null;
    tracer.stage("capability_selected", {
      domain: resolvedTurn.domain,
      operation: resolvedTurn.operation,
      capability_key: capability?.key || "legacy",
      rollout_status: capability?.rolloutStatus || "legacy_fallback",
    });

    const legacyFallback = async () => {
      tracer.stage("legacy_fallback_used", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, reason: capability ? "device_adapter_delegates_to_legacy_specialist" : "unimplemented_capability" });
      return legacyConversationAdapter.run(context.actor, context.oisContext, context.input, capability ? "device_adapter_delegates_to_legacy_specialist" : "unimplemented_capability");
    };

    let response: ConversationRunResult;
    if (capability) {
      const capabilityContext = { ...context, resolvedTurn, legacyFallback };
      const resolution = await capability.resolve(capabilityContext);
      if (resolution.supported && capability.buildReadResponse) {
        tracer.stage("evidence_planned", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, capability_key: capability.key });
        const evidence = await capability.collectEvidence(capabilityContext);
        tracer.stage("evidence_loaded", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, capability_key: capability.key, evidence_count: evidence.length });
        response = await capability.buildReadResponse(capabilityContext, evidence) as ConversationRunResult;
      } else if (resolution.supported && capability.createDraft) {
        response = await capability.createDraft(capabilityContext) as ConversationRunResult;
      } else {
        response = await legacyFallback();
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
        legacy_fallback_used: !capability || capability.key === "devices.adapter",
      },
    };
    tracer.stage("response_composed", { domain: resolvedTurn.domain, operation: resolvedTurn.operation, capability_key: capability?.key || "legacy" });
    tracer.stage("persistence_completed", { thread_id: response.thread_id || null, persistence_saved: response.persistence_saved === false ? "false" : "true" });
    tracer.finish({ thread_id: response.thread_id || null, response_state: response.persistence_saved === false ? "unsaved" : "returned" });
    return response;
  }
}

export const conversationOrchestrator = new ConversationOrchestrator();
