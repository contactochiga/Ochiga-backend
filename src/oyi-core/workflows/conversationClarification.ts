import { randomUUID } from "crypto";
import { requestedPowerState } from "../context/currentTurnAuthority";
import { temporalScopeFor } from "../context/conversationContextLayers";
import type {
  CanonicalConversationRequest,
  PendingClarification,
} from "../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../interpretation/conversationIntentRouting";

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

export function pendingClarificationFromThread(context: { state: Record<string, unknown> }): PendingClarification | null {
  const workflow = recordOf(context.state.active_workflow);
  const pending = recordOf(workflow.pending_clarification || workflow.clarification);
  if (!Object.keys(pending).length) return null;
  const expires = text(pending.expires_at);
  if (expires && Date.parse(expires) < Date.now()) return null;
  const candidates = Array.isArray(pending.candidates) ? pending.candidates.map(recordOf) : [];
  return {
    clarification_id: text(pending.clarification_id) || randomUUID(),
    thread_id: text(pending.thread_id),
    original_user_message: text(pending.original_user_message),
    operation: text(pending.operation) || "clarify",
    domain: text(pending.domain) || "devices",
    requested_action: text(pending.requested_action) || null,
    requested_state: text(pending.requested_state) || null,
    requested_phrase: text(pending.requested_phrase) || null,
    candidate_ids: Array.isArray(pending.candidate_ids) ? pending.candidate_ids.map(text).filter(Boolean) : candidates.map((candidate) => text(candidate.device_id || candidate.id)).filter(Boolean),
    candidates,
    selected_candidate_id: text(pending.selected_candidate_id) || null,
    unresolved_fields: Array.isArray(pending.unresolved_fields) ? pending.unresolved_fields.map(text).filter(Boolean) : [],
    created_at: text(pending.created_at) || new Date().toISOString(),
    expires_at: expires || null,
  };
}

export function userCancelledClarification(message: string) {
  return /^(never mind|cancel|stop|forget it|no)$/i.test(text(message));
}

export function matchPendingClarificationCandidate(pending: PendingClarification, message: string) {
  const normalized = normalizeLookupText(message);
  if (!normalized) return null;
  return pending.candidates.find((candidate) => {
    const id = normalizeLookupText(candidate.device_id || candidate.id);
    const label = normalizeLookupText(candidate.label || candidate.title || candidate.name);
    const room = normalizeLookupText(candidate.room_label || candidate.room || candidate.detail);
    const channel = normalizeLookupText(candidate.channel_code);
    return normalized === id
      || (label && (normalized === label || label.includes(normalized) || normalized.includes(label)))
      || (room && label && normalized.includes(room) && normalized.split(" ").some((token) => label.includes(token)))
      || (channel && normalized.includes(channel));
  }) || null;
}

export function pendingClarificationWorkflow(contract: IntelligenceRequestContract): PendingClarification | null {
  if (contract.scope_mode !== "clarification" || !contract.ambiguity?.required) return null;
  return {
    clarification_id: randomUUID(),
    thread_id: contract.thread_id || "",
    original_user_message: "",
    operation: contract.operation_class,
    domain: contract.intent === "device_control" ? "devices" : "devices",
    requested_action: text(contract.mutation.command) || null,
    requested_state: text(contract.mutation.desired_state) || null,
    requested_phrase: text(contract.target.label) || null,
    candidate_ids: (contract.ambiguity.candidates || []).map((candidate: Record<string, unknown>) => text(candidate.device_id || candidate.id)).filter(Boolean),
    candidates: contract.ambiguity.candidates || [],
    selected_candidate_id: null,
    unresolved_fields: ["target"],
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

export function buildClarificationContinuationResponse(input: CanonicalConversationRequest, pending: PendingClarification, selected: Record<string, unknown>) {
  const label = cleanLabel(selected.label || selected.title || selected.name, "the selected device");
  const channel = text(selected.channel_code);
  const state = text(pending.requested_state || requestedPowerState(pending.original_user_message) || requestedPowerState(input.message));
  const needsChannel = pending.domain === "devices" && !channel && /light|switch|gang/i.test(`${pending.requested_phrase} ${label}`) && !/\bchannel\s*[123]\b/i.test(label);
  const actionText = state === "on" ? "turn on" : state === "off" ? "turn off" : text(pending.requested_action) || "continue";
  const question = needsChannel ? `Which channel should I ${actionText} on ${label}?` : `I found ${label}${channel ? `, ${channel.replace(/^switch_/i, "Channel ")}` : ""}. Confirm to ${actionText}.`;
  return {
    id: `oyi-runtime:${randomUUID()}`,
    thread_id: text(input.thread_id) || pending.thread_id || randomUUID(),
    intent: "device_control",
    understood: `Resolved clarification for ${label}.`,
    message: question,
    reply: question,
    display_mode: "detail" as const,
    confidence: 0.8,
    execution: {
      status: needsChannel ? "clarification_required" : "pending_confirmation",
      current_turn_execution: false,
      pending_clarification: needsChannel ? { ...pending, selected_candidate_id: text(selected.device_id || selected.id), unresolved_fields: ["channel"] } : null,
      target_id: text(selected.device_id || selected.id),
      channel_code: channel || null,
      desired_state: state || null,
    },
    sources: [],
    cards: [],
    suggested_actions: needsChannel ? [
      { type: "clarification_choice", label: "Channel 1", value: "switch_1" },
      { type: "clarification_choice", label: "Channel 2", value: "switch_2" },
      { type: "clarification_choice", label: "Channel 3", value: "switch_3" },
    ] : [],
    confirmations: needsChannel ? [] : [{
      type: "device_command_confirmation",
      target_id: text(selected.device_id || selected.id),
      target_type: channel ? "device_channel" : "device",
      label,
      channel_code: channel || null,
      command: state || null,
      desired_state: state || null,
      risk: "device_control",
    }],
    canonical_request_contract: null,
    resolved_turn: {
      rawMessage: text(input.message),
      intent: "device_control",
      operation: needsChannel ? "clarify" : "control",
      scope: needsChannel ? "ambiguous" : "exact_object",
      domain: "devices",
      object: { type: channel ? "device_channel" : "device", id: text(selected.device_id || selected.id), label, channel_code: channel || null },
      destination: null,
      ambiguity: { required: needsChannel, question, candidates: [] },
      authority: { allowed: true, required_permission: "devices.control", confirmation_required: !needsChannel, secure_review_required: false, denial_reason: null },
      presentation: { mode: needsChannel ? "clarification" : "approval" },
      temporal_scope: temporalScopeFor(input.message),
      confidence: 0.8,
    },
    presentation_policy: needsChannel
      ? { intent: "device_control", operation: "clarify", primary: "clarification", allowed_supporting_blocks: ["clarification"], allowed_action_types: ["clarification_choice"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "hidden", snapshot_mode: "none", auto_navigation: false }
      : { intent: "device_control", operation: "control", primary: "approval", allowed_supporting_blocks: ["approval", "command_result"], allowed_action_types: ["approval", "cancel"], suppress_awareness: true, suppress_equivalent_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, evidence_visibility: "collapsed", snapshot_mode: "none", auto_navigation: false },
    facts: [],
  };
}
