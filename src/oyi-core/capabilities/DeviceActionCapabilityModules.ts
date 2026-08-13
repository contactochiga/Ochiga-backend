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

function safeErrorCode(error: unknown) {
  const value = error as any;
  return String(value?.code || value?.safe_error_code || value?.name || "internal_runtime_failure");
}

function safeErrorClass(error: unknown) {
  const value = error as any;
  return String(value?.name || value?.constructor?.name || "Error");
}

function safeErrorMessage(error: unknown) {
  const value = error as any;
  return String(value?.message || error || "Unknown device action runtime failure");
}

function deviceActionTrace(event: string, context: CapabilityContext, fields: Record<string, unknown> = {}) {
  logger.info(event, {
    request_id: context.resolvedTurn.request_id,
    correlation_id: context.resolvedTurn.correlation_id,
    thread_id: context.input.thread_id || null,
    actor_id: context.actor?.id || null,
    surface: context.input.surface,
    semantic_operation: context.resolvedTurn.semantic_frame.operation,
    capability_key: "devices.power.control",
    ...fields,
  });
}

function deviceActionFailureResult(input: {
  stage: string;
  error: unknown;
  workflow?: OyiWorkflow | null;
  actionId?: string | null;
  target?: CanonicalTarget | null;
  channelCode?: string | null;
}): DomainResult {
  const safeCode = safeErrorCode(input.error);
  const targetLabel = input.target?.label || null;
  const answer =
    input.stage === "target_resolution"
      ? "I couldn't find that device in your home. Please choose one of your available devices."
      : input.stage === "channel_validation"
        ? targetLabel
          ? `I couldn't validate that channel on ${targetLabel}. Please choose a valid channel for that device.`
          : "I couldn't validate that channel. Please choose a valid channel for the selected device."
        : input.stage === "workflow_persistence"
          ? "I understood the device command, but I could not safely save the pending workflow. I did not send any command."
          : input.stage === "action_persistence"
            ? "I understood the device command, but I could not safely save the pending action. I did not send any command."
            : "I could not safely prepare that device command. I did not send any command.";
  return {
    status: "unavailable",
    answer,
    presentation_policy: {
      primary: "text",
      allowed_supporting_blocks: ["text"],
      allowed_action_types: [],
      suppress_awareness: true,
      suppress_context_chips: true,
      suppress_duplicate_status: true,
      snapshot_mode: "none",
      auto_navigation: false,
    },
    metadata: {
      failure_stage: input.stage,
      safe_error_code: safeCode,
      workflow_id: input.workflow?.workflow_id || null,
      action_id: input.actionId || null,
      target_type: input.target?.object_type || null,
      target_id: input.target?.canonical_id || null,
      target_label: targetLabel,
      channel_code: input.channelCode || input.target?.channel_code || null,
    },
  };
}

function isControlRequest(message: string) {
  return /\b(turn|switch|power|set)\b[\s\S]{0,80}\b(on|off)\b|\b(on|off)\b[\s\S]{0,80}\b(light|switch|socket|plug|device|gang)\b/i.test(message);
}

function channelLabel(code: string | null | undefined) {
  return code ? code.replace(/^switch_/i, "Channel ") : "";
}

function stripChannelLabel(value: unknown) {
  return text(value).replace(/\s+Channel\s+\d+\s*$/i, "").trim();
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

function switchCodesFromValue(value: unknown) {
  return Array.isArray(value)
    ? value.map(text).filter((item) => /^switch_\d+$/i.test(item))
    : [];
}

function channelDefinitionsFromRuntimeState(value: unknown) {
  const state = recordOf(value);
  const normalized = recordOf(state.normalized_state);
  const switches = recordOf(normalized.switches);
  const codes = new Set<string>();
  for (const code of switchCodesFromValue(state.capability_codes)) codes.add(code);
  for (const code of switchCodesFromValue(state.supported_controls)) codes.add(code);
  for (const code of switchCodesFromValue(recordOf(state.summary).capability_codes)) codes.add(code);
  for (const code of switchCodesFromValue(recordOf(state.summary).supported_controls)) codes.add(code);
  for (const code of Object.keys(switches).filter((item) => /^switch_\d+$/i.test(item))) codes.add(code);
  for (const code of Object.keys(state).filter((item) => /^switch_\d+$/i.test(item))) codes.add(code);
  const definitions = [
    ...channelDefinitionsFromValue(state.channel_definitions),
    ...channelDefinitionsFromValue(recordOf(state.summary).channel_definitions),
    ...Array.from(codes).map((code) => ({ code, label: channelLabel(code) })),
  ];
  const byCode = new Map<string, { code: string; label: string }>();
  for (const item of definitions) byCode.set(item.code, item);
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
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
  let runtimeDefinitions: Array<{ code: string; label: string }> = [];
  const { data: stateRow, error: stateError } = await supabaseAdmin
    .from("device_states")
    .select("device_id,status,last_seen,updated_at")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (stateError) {
    logger.warn("oyi_device_action_channel_snapshot_load_failed", {
      device_id: deviceId,
      error_code: (stateError as any)?.code || null,
    });
  } else {
    runtimeDefinitions = channelDefinitionsFromRuntimeState(recordOf(stateRow).status);
  }
  const byCode = new Map<string, { code: string; label: string }>();
  for (const item of [...direct, ...capabilities, ...runtimeDefinitions]) byCode.set(item.code, item);
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
  const requestedChannelInput = requestedChannelCode(context.input.message || "");
  const restoredWorkflowChannel = workflow?.target?.channel_code || null;
  const explicitChannelTarget = target?.object_type === "device_channel" ? target.channel_code || null : null;
  const requestedChannel = requestedChannelInput || restoredWorkflowChannel || null;
  if (target?.object_type === "device_channel" && explicitChannelTarget && !requestedChannel) {
    target = {
      ...target,
      object_type: "device",
      canonical_id: target.parent_id || target.canonical_id.split(":")[0],
      channel_code: null,
      label: stripChannelLabel(target.label) || target.label,
    };
  }
  const namedPhrase = namedDevicePhraseFromControlMessage(context.input.message || "", { isControlRequest })
    || (!target && !requestedChannel ? text(context.input.message) : null);
  deviceActionTrace("oyi_device_action_target_resolution_started", context, {
    workflow_id: workflow?.workflow_id || null,
    target_type: target?.object_type || null,
    target_id: target?.canonical_id || null,
    target_label: target?.label || null,
    requested_channel_input: requestedChannelInput,
    inferred_target_channel: explicitChannelTarget,
    requested_channel: requestedChannel,
    phrase: namedPhrase || null,
  });
  if (!target && namedPhrase) {
    const resolution = await resolveNamedDeviceForRead(context.actor, context.oisContext, context.input, namedPhrase);
    deviceActionTrace(resolution.status === "resolved" ? "oyi_device_action_target_resolved" : "oyi_device_action_target_resolution_failed", context, {
      phrase: namedPhrase,
      result: resolution.status,
      device_candidate_count: resolution.status === "ambiguous" ? resolution.candidates.length : resolution.status === "resolved" ? 1 : 0,
      candidate_match_strategy: "canonical_named_device_resolver",
      resolved_device_id: resolution.status === "resolved" ? resolution.device_id : null,
      resolved_device_label: resolution.status === "resolved" ? resolution.label : null,
      requested_channel_input: requestedChannelInput,
      inferred_target_channel: explicitChannelTarget,
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
  deviceActionTrace(target ? "oyi_device_action_target_resolved" : "oyi_device_action_target_resolution_failed", context, {
    workflow_id: workflow?.workflow_id || null,
    result: target ? "resolved_existing_target" : "target_missing",
    target_type: target?.object_type || null,
    target_id: target?.canonical_id || null,
    target_label: target?.label || null,
    requested_channel_input: requestedChannelInput,
    inferred_target_channel: explicitChannelTarget,
    requested_channel: requestedChannel,
  });
  return { target, requestedChannel, requestedChannelInput, channelDefinitions, candidates: null, phrase: namedPhrase };
}

export async function createOrContinueDeviceActionDraft(context: CapabilityContext, workflow: OyiWorkflow | null = null, options: { requested?: unknown } = {}): Promise<DomainResult> {
  deviceActionTrace("oyi_device_action_request_started", context, {
    workflow_id: workflow?.workflow_id || null,
    workflow_status: workflow?.status || null,
  });
  const requested = options.requested ?? desiredState(context.resolvedTurn.semantic_frame) ?? workflow?.proposed_action?.requested_state ?? null;
  let resolved: Awaited<ReturnType<typeof resolveTargetForAction>>;
  try {
    resolved = await resolveTargetForAction(context, workflow);
  } catch (error) {
    deviceActionTrace("oyi_device_action_request_failed", context, {
      workflow_id: workflow?.workflow_id || null,
      failure_stage: "target_resolution",
      error_class: safeErrorClass(error),
      safe_error_code: safeErrorCode(error),
      error_message: safeErrorMessage(error),
    });
    return deviceActionFailureResult({ stage: "target_resolution", error, workflow });
  }
  if (resolved.candidates) {
    let nextWorkflow: OyiWorkflow;
    try {
      deviceActionTrace("oyi_device_action_workflow_create_started", context, {
        workflow_id: workflow?.workflow_id || null,
        target_type: null,
        target_id: null,
        target_label: null,
        failure_stage: null,
      });
      nextWorkflow = await ensureWorkflow(context, workflow, {
        unresolved_inputs: ["target"],
        proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
        metadata: { ...(workflow?.metadata || {}), required_input: "target", candidate_version: 1, candidates: resolved.candidates },
      }, "awaiting_clarification");
      deviceActionTrace("oyi_device_action_workflow_created", context, {
        workflow_id: nextWorkflow.workflow_id,
        workflow_status: nextWorkflow.status,
        revision: nextWorkflow.revision,
      });
    } catch (error) {
      deviceActionTrace("oyi_device_action_workflow_create_failed", context, {
        workflow_id: workflow?.workflow_id || null,
        failure_stage: "workflow_persistence",
        error_class: safeErrorClass(error),
        safe_error_code: safeErrorCode(error),
        error_message: safeErrorMessage(error),
      });
      return deviceActionFailureResult({ stage: "workflow_persistence", error, workflow });
    }
    return clarificationResult({
      workflow: nextWorkflow,
      answer: `Which ${resolved.phrase || "device"} should I use?`,
      missing: "target",
      actions: resolved.candidates.map((candidate) => ({ action_type: "clarification_choice", label: candidate.label, value: candidate.device_id })),
      metadata: { candidates: resolved.candidates },
    });
  }
  if (!resolved.target) {
    let nextWorkflow: OyiWorkflow;
    try {
      deviceActionTrace("oyi_device_action_workflow_create_started", context, {
        workflow_id: workflow?.workflow_id || null,
        failure_stage: null,
      });
      nextWorkflow = await ensureWorkflow(context, workflow, {
        unresolved_inputs: ["target"],
        proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
        metadata: { ...(workflow?.metadata || {}), semantic_operation: context.resolvedTurn.semantic_frame.operation, required_input: "target", candidate_version: 1 },
      }, "awaiting_clarification");
      deviceActionTrace("oyi_device_action_workflow_created", context, {
        workflow_id: nextWorkflow.workflow_id,
        workflow_status: nextWorkflow.status,
        revision: nextWorkflow.revision,
      });
    } catch (error) {
      deviceActionTrace("oyi_device_action_workflow_create_failed", context, {
        workflow_id: workflow?.workflow_id || null,
        failure_stage: "workflow_persistence",
        error_class: safeErrorClass(error),
        safe_error_code: safeErrorCode(error),
        error_message: safeErrorMessage(error),
      });
      return deviceActionFailureResult({ stage: "workflow_persistence", error, workflow });
    }
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
  const explicitOrRestoredChannel = resolved.requestedChannelInput || workflow?.target?.channel_code || null;
  if (resolved.requestedChannel && validChannels.size && !validChannels.has(resolved.requestedChannel)) {
    let nextWorkflow: OyiWorkflow;
    try {
      deviceActionTrace("oyi_device_action_workflow_create_started", context, {
        workflow_id: workflow?.workflow_id || null,
        target_type: resolved.target.object_type,
        target_id: resolved.target.canonical_id,
        target_label: resolved.target.label || null,
        channel_code: resolved.requestedChannel,
      });
      nextWorkflow = await ensureWorkflow(context, workflow, {
        target: resolved.target,
        unresolved_inputs: ["channel"],
        proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
        metadata: { ...(workflow?.metadata || {}), required_input: "channel", missing_input: "channel", channel_definitions: channelDefinitions },
      }, "awaiting_clarification");
      deviceActionTrace("oyi_device_action_workflow_created", context, {
        workflow_id: nextWorkflow.workflow_id,
        workflow_status: nextWorkflow.status,
        revision: nextWorkflow.revision,
      });
    } catch (error) {
      deviceActionTrace("oyi_device_action_workflow_create_failed", context, {
        workflow_id: workflow?.workflow_id || null,
        target_type: resolved.target.object_type,
        target_id: resolved.target.canonical_id,
        target_label: resolved.target.label || null,
        channel_code: resolved.requestedChannel,
        failure_stage: "workflow_persistence",
        error_class: safeErrorClass(error),
        safe_error_code: safeErrorCode(error),
        error_message: safeErrorMessage(error),
      });
      return deviceActionFailureResult({ stage: "workflow_persistence", error, workflow, target: resolved.target, channelCode: resolved.requestedChannel });
    }
    return clarificationResult({
      workflow: nextWorkflow,
      answer: `${resolved.target.label || "That device"} has ${channelDefinitions.map((item) => item.label).join(", ")}. Which one should I use?`,
      missing: "channel",
      actions: channelDefinitions.map((item) => ({ action_type: "clarification_choice", label: item.label, value: item.code })),
      metadata: { invalid_channel: resolved.requestedChannel },
    });
  }
  if (!explicitOrRestoredChannel && channelDefinitions.length > 1) {
    let nextWorkflow: OyiWorkflow;
    try {
      deviceActionTrace("oyi_device_action_workflow_create_started", context, {
        workflow_id: workflow?.workflow_id || null,
        target_type: resolved.target.object_type,
        target_id: resolved.target.canonical_id,
        target_label: resolved.target.label || null,
        requested_channel_input: resolved.requestedChannelInput || null,
        resolved_channel_code: null,
      });
      nextWorkflow = await ensureWorkflow(context, workflow, {
        target: resolved.target,
        unresolved_inputs: ["channel"],
        proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
        metadata: { ...(workflow?.metadata || {}), required_input: "channel", missing_input: "channel", channel_definitions: channelDefinitions },
      }, "awaiting_clarification");
      deviceActionTrace("oyi_device_action_workflow_created", context, {
        workflow_id: nextWorkflow.workflow_id,
        workflow_status: nextWorkflow.status,
        revision: nextWorkflow.revision,
        missing_input: "channel",
        requested_channel_input: resolved.requestedChannelInput || null,
        resolved_channel_code: null,
      });
    } catch (error) {
      deviceActionTrace("oyi_device_action_workflow_create_failed", context, {
        workflow_id: workflow?.workflow_id || null,
        target_type: resolved.target.object_type,
        target_id: resolved.target.canonical_id,
        target_label: resolved.target.label || null,
        failure_stage: "workflow_persistence",
        error_class: safeErrorClass(error),
        safe_error_code: safeErrorCode(error),
        error_message: safeErrorMessage(error),
      });
      return deviceActionFailureResult({ stage: "workflow_persistence", error, workflow, target: resolved.target });
    }
    return clarificationResult({
      workflow: nextWorkflow,
      answer: `Which channel on ${resolved.target.label || "that device"} should I ${actionText(requested)}?`,
      missing: "channel",
      actions: channelDefinitions.map((item) => ({ action_type: "clarification_choice", label: item.label, value: item.code })),
      metadata: { target_id: resolved.target.canonical_id, channel_definitions: channelDefinitions },
    });
  }

  const finalTarget = targetWithChannel(resolved.target, resolved.requestedChannel || resolved.target.channel_code || null);
  let nextWorkflow: OyiWorkflow;
  try {
    deviceActionTrace("oyi_device_action_workflow_create_started", context, {
      workflow_id: workflow?.workflow_id || null,
      target_type: finalTarget.object_type,
      target_id: finalTarget.canonical_id,
      target_label: resolved.target.label || finalTarget.label || null,
      channel_code: finalTarget.channel_code || null,
    });
    nextWorkflow = await ensureWorkflow(context, workflow, {
      target: finalTarget,
      unresolved_inputs: [],
      proposed_action: { ...(workflow?.proposed_action || {}), requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
      metadata: { ...(workflow?.metadata || {}), channel_definitions: channelDefinitions },
    }, "awaiting_approval");
    if (nextWorkflow.status === "awaiting_clarification") nextWorkflow = await workflowService.transition(nextWorkflow, "ready_for_review");
    if (nextWorkflow.status === "ready_for_review") nextWorkflow = await workflowService.transition(nextWorkflow, "awaiting_approval");
    deviceActionTrace("oyi_device_action_workflow_created", context, {
      workflow_id: nextWorkflow.workflow_id,
      workflow_status: nextWorkflow.status,
      revision: nextWorkflow.revision,
      target_type: finalTarget.object_type,
      target_id: finalTarget.canonical_id,
      channel_code: finalTarget.channel_code || null,
    });
  } catch (error) {
    deviceActionTrace("oyi_device_action_workflow_create_failed", context, {
      workflow_id: workflow?.workflow_id || null,
      target_type: finalTarget.object_type,
      target_id: finalTarget.canonical_id,
      target_label: resolved.target.label || finalTarget.label || null,
      channel_code: finalTarget.channel_code || null,
      failure_stage: "workflow_persistence",
      error_class: safeErrorClass(error),
      safe_error_code: safeErrorCode(error),
      error_message: safeErrorMessage(error),
    });
    return deviceActionFailureResult({ stage: "workflow_persistence", error, workflow, target: finalTarget, channelCode: finalTarget.channel_code || null });
  }

  let action: Awaited<ReturnType<typeof actionService.create>>;
  try {
    deviceActionTrace("oyi_device_action_action_create_started", context, {
      workflow_id: nextWorkflow.workflow_id,
      target_type: finalTarget.object_type,
      target_id: finalTarget.canonical_id,
      target_label: resolved.target.label || finalTarget.label || null,
      channel_code: finalTarget.channel_code || null,
      requested_operation: context.resolvedTurn.semantic_frame.operation,
      requested_state: requested,
    });
    action = await actionService.create({
      workflow: nextWorkflow,
      actorId: context.actor?.id || null,
      target: finalTarget,
      requestedOperation: context.resolvedTurn.semantic_frame.operation,
      requestedState: requested,
    });
    deviceActionTrace("oyi_device_action_action_created", context, {
      workflow_id: nextWorkflow.workflow_id,
      action_id: action.action_id,
      action_status: action.status,
      target_type: action.target.object_type,
      target_id: action.target.canonical_id,
      target_label: action.target.label || null,
      channel_code: action.target.channel_code || null,
      revision: action.revision,
    });
    await workflowService.attachAction(nextWorkflow, action.action_id);
  } catch (error) {
    deviceActionTrace("oyi_device_action_action_create_failed", context, {
      workflow_id: nextWorkflow.workflow_id,
      target_type: finalTarget.object_type,
      target_id: finalTarget.canonical_id,
      target_label: resolved.target.label || finalTarget.label || null,
      channel_code: finalTarget.channel_code || null,
      failure_stage: "action_persistence",
      error_class: safeErrorClass(error),
      safe_error_code: safeErrorCode(error),
      error_message: safeErrorMessage(error),
    });
    return deviceActionFailureResult({ stage: "action_persistence", error, workflow: nextWorkflow, target: finalTarget, channelCode: finalTarget.channel_code || null });
  }
  const deviceLabel = resolved.target.label || finalTarget.label || "the selected device";
  const channelText = finalTarget.channel_code ? ` ${channelLabel(finalTarget.channel_code)}` : "";
  const answer = `Please confirm: ${actionText(requested)}${channelText} on ${deviceLabel}. No command was sent yet.`;
  deviceActionTrace("oyi_device_action_confirmation_response_started", context, {
    workflow_id: nextWorkflow.workflow_id,
    action_id: action.action_id,
    target_type: finalTarget.object_type,
    target_id: finalTarget.canonical_id,
    target_label: deviceLabel,
    channel_code: finalTarget.channel_code || null,
  });
  deviceActionTrace("oyi_device_action_confirmation_response_completed", context, {
    workflow_id: nextWorkflow.workflow_id,
    action_id: action.action_id,
    target_type: finalTarget.object_type,
    target_id: finalTarget.canonical_id,
    target_label: deviceLabel,
    channel_code: finalTarget.channel_code || null,
  });
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
