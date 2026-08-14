import { randomUUID } from "crypto";
import type { CanonicalConversationResponse, CanonicalTruth, IntelligenceFact } from "../contracts/canonicalConversation";
import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import type { DomainResult } from "../contracts/domainResult";
import type { OyiEvidence } from "../contracts/evidence";

function factsFromEvidencePayload(evidence: OyiEvidence[]): IntelligenceFact[] {
  return evidence
    .map((item) => (item.payload && typeof item.payload === "object" ? (item.payload as Record<string, unknown>).fact : null))
    .filter((fact): fact is IntelligenceFact => Boolean(fact && typeof fact === "object"));
}

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
  if (result.status === "awaiting_confirmation" || primary === "approval") return "detail";
  if (primary === "table" || primary === "list") return "list";
  if (primary === "detail") return "detail";
  return "conversation";
}

function workflowStatusFor(result: DomainResult) {
  if (typeof result.metadata?.workflow_status === "string" && result.metadata.workflow_status.length > 0) {
    return result.metadata.workflow_status;
  }
  if (result.status === "draft" && typeof result.metadata?.missing_input === "string") {
    return "awaiting_clarification";
  }
  if (result.status === "awaiting_confirmation") {
    return "awaiting_approval";
  }
  return result.status;
}

function sourceLabelFor(evidence: OyiEvidence, capability: CapabilityModule) {
  if (capability.key === "wallet.transactions.read") return "Wallet transactions";
  if (capability.key === "utilities.spending.read") return "Utility records";
  if (evidence.domain === "wallet") return "Wallet transactions";
  if (evidence.domain === "utilities") return "Utility records";
  if (evidence.domain === "devices") return "Device evidence";
  if (evidence.domain === "maintenance") return "Maintenance records";
  if (evidence.domain === "visitors" || evidence.domain === "access") return "Visitor access records";
  if (evidence.domain === "security") return "Security records";
  return `${text(evidence.domain) || "Oyi"} evidence`;
}

function dedupeSources(evidence: OyiEvidence[], capability: CapabilityModule) {
  const seen = new Set<string>();
  const sources: Array<Record<string, unknown>> = [];
  for (const item of evidence) {
    const label = sourceLabelFor(item, capability);
    const key = [capability.key, label, item.privacy_class].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      id: item.source_id || item.evidence_id,
      type: item.source_type || item.type,
      domain: item.domain,
      label,
      title: label,
      freshness: item.freshness,
      privacy_class: item.privacy_class,
      object_type: item.object_type,
      object_id: item.object_id,
      evidence_count: evidence.filter((candidate) => [capability.key, sourceLabelFor(candidate, capability), candidate.privacy_class].join(":") === key).length,
    });
  }
  return sources;
}

export function capabilityDomainResultToConversationResponse(input: {
  context: CapabilityContext;
  capability: CapabilityModule;
  result: DomainResult;
  evidence: OyiEvidence[];
}): CanonicalConversationResponse {
  const answer = text(input.result.answer) || "Oyi could not produce an answer for this capability.";
  const now = new Date().toISOString();
  const sources = dedupeSources(input.evidence, input.capability);
  const firstEvidence = input.evidence[0] || null;
  const confirmationRequired = input.result.status === "awaiting_confirmation";
  const confirmations = Array.isArray(input.result.metadata?.confirmations) ? input.result.metadata.confirmations as Array<Record<string, unknown>> : [];
  const activeExecution = input.result.metadata?.workflow_id || input.result.metadata?.action_id
    ? {
      workflow_id: input.result.metadata.workflow_id || null,
      action_id: input.result.metadata.action_id || null,
      status: input.result.status,
      capability_key: input.capability.key,
    }
    : null;
  const workflowMetadata = input.result.metadata?.workflow_id
    ? {
      workflow_id: input.result.metadata.workflow_id,
      action_id: input.result.metadata.action_id || null,
      status: workflowStatusFor(input.result),
      capability_key: input.capability.key,
      missing_input: input.result.metadata.missing_input || null,
      target_id: input.result.metadata.target_id || null,
      channel_code: input.result.metadata.channel_code || null,
      desired_state: input.result.metadata.desired_state || null,
    }
    : null;
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
      active_execution: activeExecution,
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
      status: confirmationRequired ? "pending_confirmation" : "read_only",
      current_turn_execution: false,
      capability_key: input.capability.key,
      capability_result: input.result.status,
      workflow_id: input.result.metadata?.workflow_id || null,
      action_id: input.result.metadata?.action_id || null,
      workflow: workflowMetadata,
      failure_stage: typeof input.result.metadata?.failure_stage === "string" ? input.result.metadata.failure_stage : null,
      safe_error_code: typeof input.result.metadata?.safe_error_code === "string" ? input.result.metadata.safe_error_code : null,
    },
    cards: Array.isArray(input.result.blocks) ? input.result.blocks : [],
    sources,
    suggested_actions: Array.isArray(input.result.actions) ? input.result.actions : [],
    presentation_policy: input.result.presentation_policy as any,
    confirmations,
    warnings: [],
    persistence_saved: false,
    source: "oyi_canonical_runtime",
    safe_mode: true,
    approvalRequired: confirmationRequired,
    requiresConfirmation: confirmationRequired,
    facts: factsFromEvidencePayload(input.evidence),
    capability_key: input.capability.key,
  };
}
