import { randomUUID } from "crypto";
import type { CanonicalConversationResponse, CanonicalTruth } from "../contracts/canonicalConversation";
import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import type { DomainResult } from "../contracts/domainResult";
import type { OyiEvidence } from "../contracts/evidence";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function truthStateFor(result: DomainResult): CanonicalTruth["truth_state"] {
  if (result.status === "permission_restricted") return "permission_restricted";
  if (result.status === "unsupported") return "unsupported";
  if (result.status === "unavailable") return "unavailable";
  if (result.status === "empty") return "confirmed";
  return "observed";
}

function displayModeFor(result: DomainResult): CanonicalConversationResponse["display_mode"] {
  const primary = result.presentation_policy?.primary;
  if (primary === "table" || primary === "list") return "list";
  if (primary === "detail") return "detail";
  return "conversation";
}

export function capabilityDomainResultToConversationResponse(input: {
  context: CapabilityContext;
  capability: CapabilityModule;
  result: DomainResult;
  evidence: OyiEvidence[];
}): CanonicalConversationResponse {
  const answer = text(input.result.answer) || "Oyi could not produce an answer for this capability.";
  const now = new Date().toISOString();
  const sources = input.evidence.map((item) => ({
    id: item.evidence_id,
    type: item.type,
    domain: item.domain,
    freshness: item.freshness,
    privacy_class: item.privacy_class,
    object_type: item.object_type,
    object_id: item.object_id,
  }));
  const firstEvidence = input.evidence[0] || null;
  return {
    id: randomUUID(),
    thread_id: input.context.input.thread_id || null,
    intent: input.context.resolvedTurn.semantic_frame.operation,
    understood: `Handled by ${input.capability.key}.`,
    summary: answer,
    answer,
    reply: answer,
    message: answer,
    display_mode: displayModeFor(input.result),
    truth: {
      title: input.capability.key,
      body: answer,
      truth_state: truthStateFor(input.result),
      severity: input.result.status === "permission_restricted" || input.result.status === "unavailable" ? "attention" : "normal",
      source_event: firstEvidence?.source_id || null,
      confidence: typeof input.result.metadata?.confidence === "number" ? Number(input.result.metadata.confidence) : null,
      object: null,
      occurred_at: firstEvidence?.observed_at || null,
      freshness: firstEvidence?.freshness || now,
      recommended_actions: Array.isArray(input.result.actions) ? input.result.actions : [],
      active_execution: null,
      target: input.context.input.target || null,
      technical_details: {
        capability_key: input.capability.key,
        result_status: input.result.status,
        rollout_status: input.capability.rolloutStatus,
      },
    },
    operational_object: null,
    context: {
      surface: input.context.input.surface,
      estate_id: input.context.resolvedTurn.scope.estate_id,
      home_id: input.context.resolvedTurn.scope.home_id,
      module: input.context.input.module || input.capability.domain,
      context_source: "explicit_request",
      warnings: [],
      module_facts: {
        capability_key: input.capability.key,
        result_status: input.result.status,
        evidence_count: input.evidence.length,
      },
    },
    execution: {
      status: "read_only",
      current_turn_execution: false,
      capability_key: input.capability.key,
      capability_result: input.result.status,
    },
    cards: Array.isArray(input.result.blocks) ? input.result.blocks : [],
    sources,
    suggested_actions: Array.isArray(input.result.actions) ? input.result.actions : [],
    presentation_policy: input.result.presentation_policy as any,
    confirmations: [],
    warnings: [],
    persistence_saved: false,
    source: "oyi_canonical_runtime",
    safe_mode: true,
    approvalRequired: false,
    requiresConfirmation: false,
  };
}
