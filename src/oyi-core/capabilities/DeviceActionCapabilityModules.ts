import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import type { DomainResult } from "../contracts/domainResult";
import type { PresentationPolicy } from "../contracts/presentation";
import type { SemanticFrame } from "../contracts/semanticFrame";
import type { CanonicalTarget } from "../contracts/target";
import type { OyiWorkflow } from "../contracts/workflow";
import { logger } from "../../observability/logger";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { namedDevicePhraseFromControlMessage, requestedChannelCode, resolveNamedDeviceForRead } from "../runtime/conversationTargetResolver";
import { actionService, workflowService } from "../workflows/defaultWorkflowActionServices";

function desiredState(frame: SemanticFrame) {
  if (frame.operation === "device.power.on") return true;
  if (frame.operation === "device.power.off") return false;
  return null;
}

function stateLabel(value: unknown) {
  return value === true ? "ON" : value === false ? "OFF" : "requested";
}

function actionText(value: unknown) {
  return value === true ? "turn on" : value === false ? "turn off" : "control";
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isControlRequest(message: string) {
  return /\b(turn|switch|power|set)\b[\s\S]{0,80}\b(on|off)\b|\b(on|off)\b[\s\S]{0,80}\b(light|switch|socket|plug|device|gang)\b/i.test(message);
}

function channelLabel(code: string | null | undefined) {
  return code ? code.replace(/^switch_/i, "Channel ") : "";
}

function approvalPresentation(): PresentationPolicy {
  return {
    primary: "approval",
    allowed_supporting_blocks: ["text", "approval"],
    allowed_action_types: ["approval", "cancel"],
    suppress_awareness: true,
    suppress_context_chips: true,
    suppress_duplicate_status: true,
    snapshot_mode: "none",
    auto_navigation: false,
  };
}

function clarificationPresentation(): PresentationPolicy {
  return {
    ...approvalPresentation(),
    primary: "clarification",
    allowed_supporting_blocks: ["text", "clarification"],
    allowed_action_types: ["clarification_choice", "cancel"],
  };
}

function channelDefinitionsFromValue(value: unknown) {
  const definitions = Array.isArray(value) ? value.map(recordOf) : [];
  return definitions
    .map((item) => {
      const code = text(item.code || item.channel_code || item.key);
      if (!/^switch_\d+$/i.test(code)) return null;
      return { code, label: text(item.label || item.name) || channelLabel(code) };
    })
    .filter(Boolean) as Array<{ code: string; label: string }>;
}

function targetWithChannel(target: CanonicalTarget, channelCode: string | null): CanonicalTarget {
  if (!channelCode) return { ...target, object_type: "device", channel_code: null };
  return {
    ...target,
    object_type: "device_channel",
    canonical_id: target.parent_id || target.canonical_id.split(":")[0],
    channel_code: channelCode,
    label: target.label ? `${target.label} ${channelLabel(channelCode)}` : channelLabel(channelCode),
  };
}

async function loadChannelDefinitions(target: CanonicalTarget) {
  const deviceId = target.parent_id || target.canonical_id.split(":")[0];
  if (!deviceId) return [];
  const { data, error } = await supabaseAdmin
    .from("devices")
    .select("id,name,capabilities,metadata")
    .eq("id", deviceId)
    .maybeSingle();
  if (error) throw error;
  const row = recordOf(data);
  const metadata = recordOf(row.metadata);
  const direct = channelDefinitionsFromValue(metadata.channel_definitions);
  const capabilities = Array.isArray(row.capabilities)
    ? row.capabilities.map(text).filter((item) => /^switch_\d+$/i.test(item)).map((code) => ({ code, label: channelLabel(code) }))
    : [];
  const byCode = new Map<string, { code: string; label: string }>();
  for (const item of [...direct, ...capabilities]) byCode.set(item.code, item);
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}

function clarificationResult(input: {
  workflow: OyiWorkflow;
  answer: string;
  missing: "target" | "channel";
  actions?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}): DomainResult {
  return {
    status: "draft",
    answer: input.answer,
    actions: input.actions || [],
    presentation_policy: clarificationPresentation(),
    metadata: { workflow_id: input.workflow.workflow_id, missing_input: input.missing, ...(input.metadata || {}) },
  };
}

async function ensureWorkflow(context: CapabilityContext, existing: OyiWorkflow | null, patch: Partial<OyiWorkflow>, status: "awaiting_clarification" | "awaiting_approval") {
  const normalizedPatch = { ...patch, capability_key: "devices.power.control" };
  if (existing) return workflowService.update(existing, normalizedPatch);
  return workflowService.create(context.resolvedTurn, status, {
    ...normalizedPatch,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
}

async function resolveTargetForAction(context: CapabilityContext, workflow: OyiWorkflow | null) {
  let target = context.resolvedTurn.target || workflow?.target || null;
  let channelDefinitions = channelDefinitionsFromValue(workflow?.metadata?.channel_definitions);
  const requestedChannel = requestedChannelCode(context.input.message || "") || target?.channel_code || null;
  const namedPhrase = namedDevicePhraseFromControlMessage(context.input.message || "", { isControlRequest })
    || (!target && !requestedChannel ? text(context.input.message) : null);
  if (!target && namedPhrase) {
    const resolution = await resolveNamedDeviceForRead(context.actor, context.oisContext, context.input, namedPhrase);
    logger.info("oyi_device_action_target_resolution", {
      request_id: context.resolvedTurn.request_id,
      thread_id: context.input.thread_id || null,
      capability_key: "devices.power.control",
      phrase: namedPhrase,
      result: resolution.status,
      device_candidate_count: resolution.status === "ambiguous" ? resolution.candidates.length : resolution.status === "resolved" ? 1 : 0,
      candidate_match_strategy: "canonical_named_device_resolver",
      resolved_device_id: resolution.status === "resolved" ? resolution.device_id : null,
      resolved_device_label: resolution.status === "resolved" ? resolution.label : null,
      requested_channel: requestedChannel,
    });
    if (resolution.status === "resolved") {
      target = {
        object_type: resolution.channel_code ? "device_channel" : "device",
        canonical_id: resolution.device_id,
        label: resolution.label,
        channel_code: resolution.channel_code,
        room_id: resolution.room_id,
        home_id: context.input.home_id || context.oisContext?.home_id || null,
        estate_id: context.input.estate_id || context.oisContext?.estate_id || null,
      };
      channelDefinitions = resolution.channel_definitions || [];
    }
    if (resolution.status === "ambiguous") return { target: null, requestedChannel, channelDefinitions, candidates: resolution.candidates, phrase: namedPhrase };
  }
  return { target, requestedChannel, channelDefinitions, candidates: null, phrase: namedPhrase };
}

export async function createOrContinueDeviceActionDraft(context: CapabilityContext, workflow: OyiWorkflow | null = null, options: { requested?: unknown } = {}): Promise<DomainResult> {
  const requested = options.requested ?? desiredState(context.resolvedTurn.semantic_frame) ?? workflow?.proposed_action?.requested_state ?? null;
  const resolved = await resolveTargetForAction(context, workflow);
  if (resolved.candidates) {
    const nextWorkflow = await ensureWorkflow(context, workflow, {
      unresolved_inputs: ["target"],
      proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
      metadata: { ...(workflow?.metadata || {}), required_input: "target", candidate_version: 1, candidates: resolved.candidates },
    }, "awaiting_clarification");
    return clarificationResult({
      workflow: nextWorkflow,
      answer: `Which ${resolved.phrase || "device"} should I use?`,
      missing: "target",
      actions: resolved.candidates.map((candidate) => ({ action_type: "clarification_choice", label: candidate.label, value: candidate.device_id })),
      metadata: { candidates: resolved.candidates },
    });
  }
  if (!resolved.target) {
    const nextWorkflow = await ensureWorkflow(context, workflow, {
      unresolved_inputs: ["target"],
      proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
      metadata: { ...(workflow?.metadata || {}), semantic_operation: context.resolvedTurn.semantic_frame.operation, required_input: "target", candidate_version: 1 },
    }, "awaiting_clarification");
    return clarificationResult({
      workflow: nextWorkflow,
      answer: "I can prepare that device command, but I need the exact device first. Which device should I use?",
      missing: "target",
    });
  }
  let channelDefinitions = resolved.channelDefinitions;
  if (!channelDefinitions.length) {
    channelDefinitions = await loadChannelDefinitions(resolved.target).catch((error) => {
      logger.warn("oyi_device_action_channel_definition_load_failed", { target_id: resolved.target?.canonical_id || null, error: (error as any)?.message || String(error) });
      return [];
    });
  }
  const validChannels = new Set(channelDefinitions.map((item) => item.code));
  if (resolved.requestedChannel && validChannels.size && !validChannels.has(resolved.requestedChannel)) {
    const nextWorkflow = await ensureWorkflow(context, workflow, {
      target: resolved.target,
      unresolved_inputs: ["channel"],
      proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
      metadata: { ...(workflow?.metadata || {}), required_input: "channel", channel_definitions: channelDefinitions },
    }, "awaiting_clarification");
    return clarificationResult({
      workflow: nextWorkflow,
      answer: `${resolved.target.label || "That device"} has ${channelDefinitions.map((item) => item.label).join(", ")}. Which one should I use?`,
      missing: "channel",
      actions: channelDefinitions.map((item) => ({ action_type: "clarification_choice", label: item.label, value: item.code })),
      metadata: { invalid_channel: resolved.requestedChannel },
    });
  }
  if (!resolved.requestedChannel && channelDefinitions.length > 1) {
    const nextWorkflow = await ensureWorkflow(context, workflow, {
      target: resolved.target,
      unresolved_inputs: ["channel"],
      proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
      metadata: { ...(workflow?.metadata || {}), required_input: "channel", channel_definitions: channelDefinitions },
    }, "awaiting_clarification");
    return clarificationResult({
      workflow: nextWorkflow,
      answer: `Which channel should I ${actionText(requested)} on ${resolved.target.label || "that device"}?`,
      missing: "channel",
      actions: channelDefinitions.map((item) => ({ action_type: "clarification_choice", label: item.label, value: item.code })),
      metadata: { target_id: resolved.target.canonical_id },
    });
  }

  const finalTarget = targetWithChannel(resolved.target, resolved.requestedChannel || resolved.target.channel_code || null);
  let nextWorkflow = await ensureWorkflow(context, workflow, {
    target: finalTarget,
    unresolved_inputs: [],
    proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
    metadata: { ...(workflow?.metadata || {}), channel_definitions: channelDefinitions },
  }, "awaiting_approval");
  if (nextWorkflow.status === "awaiting_clarification") nextWorkflow = await workflowService.transition(nextWorkflow, "ready_for_review");
  if (nextWorkflow.status === "ready_for_review") nextWorkflow = await workflowService.transition(nextWorkflow, "awaiting_approval");

  const action = await actionService.create({
    workflow: nextWorkflow,
    actorId: context.actor?.id || null,
    target: finalTarget,
    requestedOperation: context.resolvedTurn.semantic_frame.operation,
    requestedState: requested,
  });
  await workflowService.attachAction(nextWorkflow, action.action_id);
  const deviceLabel = resolved.target.label || finalTarget.label || "the selected device";
  const channelText = finalTarget.channel_code ? ` ${channelLabel(finalTarget.channel_code)}` : "";
  const answer = `Please confirm: ${actionText(requested)}${channelText} on ${deviceLabel}. No command was sent yet.`;
  return {
    status: "awaiting_confirmation",
    answer,
    actions: [
      { action_type: "approval", label: "Confirm", workflow_id: nextWorkflow.workflow_id, action_id: action.action_id },
      { action_type: "cancel", label: "Cancel", workflow_id: nextWorkflow.workflow_id, action_id: action.action_id },
    ],
    presentation_policy: approvalPresentation(),
    metadata: {
      workflow_id: nextWorkflow.workflow_id,
      action_id: action.action_id,
      confirmations: [{
        type: "device_command_confirmation",
        workflow_id: nextWorkflow.workflow_id,
        action_id: action.action_id,
        target_id: finalTarget.canonical_id,
        target_type: finalTarget.object_type,
        label: deviceLabel,
        channel_code: finalTarget.channel_code || null,
        command: context.resolvedTurn.semantic_frame.operation,
        desired_state: requested,
        risk: "device_control",
      }],
    },
  };
}

async function deviceActionDraft(context: CapabilityContext): Promise<DomainResult> {
  return createOrContinueDeviceActionDraft(context);
}

export async function continueDeviceActionWorkflow(context: CapabilityContext, workflow: OyiWorkflow): Promise<DomainResult | null> {
  if (workflow.capability_key !== "devices.power.control" || workflow.status !== "awaiting_clarification") return null;
  if (context.resolvedTurn.semantic_frame.domain && context.resolvedTurn.semantic_frame.domain !== "devices") return null;
  const missing = workflow.unresolved_inputs[0] || text(workflow.metadata?.required_input);
  logger.info("oyi_workflow_continuation_detected", {
    thread_id: workflow.thread_id,
    workflow_id: workflow.workflow_id,
    capability_key: workflow.capability_key,
    missing_input: missing || null,
    revision: workflow.revision,
  });
  if ((missing === "target" || !workflow.target) && requestedChannelCode(context.input.message || "")) {
    return clarificationResult({
      workflow,
      answer: "I still need the device first. Which device should I use?",
      missing: "target",
      metadata: { rejected_input: "channel_without_target" },
    });
  }
  const result = await createOrContinueDeviceActionDraft(context, workflow, { requested: workflow.proposed_action?.requested_state });
  logger.info("oyi_workflow_clarification_resolved", {
    thread_id: workflow.thread_id,
    workflow_id: workflow.workflow_id,
    capability_key: workflow.capability_key,
    missing_input: missing || null,
    result_type: result.status,
    requested_channel: requestedChannelCode(context.input.message || ""),
  });
  return result;
}

export function buildDeviceActionCapabilities(): CapabilityModule[] {
  return [{
    key: "devices.power.control",
    domain: "devices",
    rolloutStatus: "enabled",
    operations: ["device.power.on", "device.power.off"],
    supported_surfaces: ["consumer", "facility"],
    scope_requirements: [{ scope: "home", required: true }],
    permission_requirements: ["devices.control"],
    risk_class: "low_risk_action",
    confirmation_policy: "explicit_confirmation",
    evidence_requirements: [{ domain: "devices", evidence_type: "device_current_state", freshness: ["fresh", "stale", "expired", "unknown", "provider_disconnected"], required: true }],
    workflow_definition: {
      workflow_key: "devices.power.control",
      initial_status: "awaiting_approval",
      terminal_statuses: ["completed", "failed", "cancelled", "expired", "superseded"],
      requires_durable_state: true,
    },
    presentation_policy: { primary: "approval", expose_evidence: "summary", allow_internal_ids: false },
    supports: (frame) => frame.domain === "devices" && (frame.operation === "device.power.on" || frame.operation === "device.power.off"),
    async resolve() {
      return { supported: true, reason: null };
    },
    async collectEvidence() {
      return [];
    },
    createDraft: deviceActionDraft,
  }];
}
