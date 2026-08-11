import { randomUUID } from "crypto";
import type { AuthUser } from "../../middleware/auth";
import type { OisContext } from "../../types/oisContext";
import type { CanonicalConversationRequest } from "../contracts/canonicalConversation";
import type { AuthorityDecision } from "../contracts/authority";
import type { PresentationPolicy } from "../contracts/presentation";
import type { ResolvedTurn } from "../contracts/resolvedTurn";
import type { SemanticFrame } from "../contracts/semanticFrame";
import type { CanonicalTarget, TargetSource } from "../contracts/target";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function targetFromInput(input: CanonicalConversationRequest): CanonicalTarget | null {
  const raw = (input.target || input.operational_object || null) as any;
  const objectType = text(raw?.object_type || raw?.type);
  const id = text(raw?.canonical_id || raw?.object_id || raw?.id);
  if (!objectType || !id) return null;
  return {
    object_type: objectType,
    canonical_id: id,
    label: text(raw?.label || raw?.object_name || raw?.name) || null,
    parent_id: text(raw?.parent_device_id || raw?.parent_id) || null,
    channel_code: text(raw?.channel_code) || null,
    room_id: text(raw?.room_id || input.room_id) || null,
    home_id: text(raw?.home_id || input.home_id) || null,
    estate_id: text(raw?.estate_id || input.estate_id) || null,
  };
}

function targetSource(frame: SemanticFrame, input: CanonicalConversationRequest, activeWorkflowId: string | null): TargetSource {
  if (activeWorkflowId) return "active_workflow";
  if (frame.primaryEntity) return "current_turn";
  if (frame.constraints.some((constraint) => constraint.type === "scope" || constraint.type === "room")) return "current_scope";
  if (frame.references.length) return "valid_reference";
  if (input.target || input.operational_object) return "page_context";
  if (input.memory_summary || input.conversation_context) return "thread_memory";
  return "none";
}

function authorityFor(frame: SemanticFrame): AuthorityDecision {
  const mutation = frame.mutationIntent;
  const sensitive = ["wallet", "utilities", "access", "visitors"].includes(frame.domain || "") && mutation;
  return {
    allowed: true,
    tier: sensitive ? 3 : mutation ? 1 : 0,
    approval_required: mutation,
    secure_review_required: sensitive,
    required_permissions: [],
    denial_reason: null,
  };
}

function presentationFor(frame: SemanticFrame): PresentationPolicy {
  if (frame.operation === "navigate") return { primary: "navigation", allowed_supporting_blocks: ["text"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: true };
  if (frame.mutationIntent) return { primary: "approval", allowed_supporting_blocks: ["review", "approval"], allowed_action_types: ["approval", "cancel"], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false };
  if (["wallet", "utilities", "devices", "rooms"].includes(frame.domain || "")) return { primary: "table", allowed_supporting_blocks: ["text", "table"], allowed_action_types: ["navigation"], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "current_state_snapshot", auto_navigation: false };
  return { primary: "text", allowed_supporting_blocks: ["text"], allowed_action_types: [], suppress_awareness: false, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false };
}

export function resolveTurnAuthority(input: {
  actor: AuthUser | null;
  oisContext: OisContext | null | undefined;
  request: CanonicalConversationRequest;
  frame: SemanticFrame;
  activeWorkflowId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  runtimeId?: string | null;
}): ResolvedTurn {
  const request = input.request;
  const oisRecord = (input.oisContext || {}) as Record<string, unknown>;
  const requestId = input.requestId || randomUUID();
  const source = targetSource(input.frame, request, input.activeWorkflowId || null);
  return {
    request_id: requestId,
    correlation_id: input.correlationId || requestId,
    runtime_id: input.runtimeId || randomUUID(),
    thread_id: request.thread_id || null,
    actor: input.actor ? { id: input.actor.id, role: input.actor.role, permissions: input.actor.permissions || [] } : null,
    semantic_frame: input.frame,
    operation: input.frame.operation,
    capability_key: `${input.frame.domain || "global"}.${input.frame.operation}`,
    domain: input.frame.domain,
    scope: {
      estate_id: request.estate_id || input.oisContext?.estate_id || null,
      building_id: text((request.context as any)?.building_id || oisRecord.building_id) || null,
      home_id: request.home_id || input.oisContext?.home_id || null,
      room_id: request.room_id || null,
    },
    target: source === "page_context" || source === "valid_reference" ? targetFromInput(request) : targetFromInput(request),
    target_source: source,
    active_workflow_id: input.activeWorkflowId || null,
    authority: authorityFor(input.frame),
    temporal_scope: input.frame.temporalScope,
    presentation_policy: presentationFor(input.frame),
    context: request.context || input.oisContext || null,
  };
}
