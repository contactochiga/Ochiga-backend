import type { CapabilityContext, CapabilityModule } from "../contracts/capability";
import type { DomainResult } from "../contracts/domainResult";
import type { PresentationPolicy } from "../contracts/presentation";
import type { SemanticFrame } from "../contracts/semanticFrame";
import { actionService, workflowService } from "../workflows/defaultWorkflowActionServices";

function desiredState(frame: SemanticFrame) {
  if (frame.operation === "device.power.on") return true;
  if (frame.operation === "device.power.off") return false;
  return null;
}

function stateLabel(value: unknown) {
  return value === true ? "ON" : value === false ? "OFF" : "requested";
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

async function deviceActionDraft(context: CapabilityContext): Promise<DomainResult> {
  const requested = desiredState(context.resolvedTurn.semantic_frame);
  const target = context.resolvedTurn.target;
  const workflow = await workflowService.create(context.resolvedTurn, target ? "awaiting_approval" : "awaiting_clarification", {
    capability_key: context.resolvedTurn.semantic_frame.operation === "device.power.on" ? "devices.power.control" : "devices.power.control",
    unresolved_inputs: target ? [] : ["target"],
    proposed_action: { requested_state: requested, operation: context.resolvedTurn.semantic_frame.operation },
    metadata: {
      semantic_operation: context.resolvedTurn.semantic_frame.operation,
      candidate_version: 1,
      candidates: [],
    },
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  if (!target) {
    return {
      status: "draft",
      answer: "I can prepare that device command, but I need the exact device first. Which device should I use?",
      actions: [],
      presentation_policy: {
        ...approvalPresentation(),
        primary: "clarification",
        allowed_supporting_blocks: ["text", "clarification"],
        allowed_action_types: ["clarification_choice", "cancel"],
      },
      metadata: { workflow_id: workflow.workflow_id, missing_input: "target" },
    };
  }
  const action = await actionService.create({
    workflow,
    actorId: context.actor?.id || null,
    target,
    requestedOperation: context.resolvedTurn.semantic_frame.operation,
    requestedState: requested,
  });
  await workflowService.attachAction(workflow, action.action_id);
  const label = target.label || "the selected device";
  const answer = `I found ${label}. Please confirm before I send the ${stateLabel(requested)} command. No command was sent yet.`;
  return {
    status: "awaiting_confirmation",
    answer,
    actions: [
      { action_type: "approval", label: "Confirm", workflow_id: workflow.workflow_id, action_id: action.action_id },
      { action_type: "cancel", label: "Cancel", workflow_id: workflow.workflow_id, action_id: action.action_id },
    ],
    presentation_policy: approvalPresentation(),
    metadata: {
      workflow_id: workflow.workflow_id,
      action_id: action.action_id,
      confirmations: [{
        type: "device_command_confirmation",
        workflow_id: workflow.workflow_id,
        action_id: action.action_id,
        target_id: target.canonical_id,
        target_type: target.object_type,
        label,
        channel_code: target.channel_code || null,
        command: context.resolvedTurn.semantic_frame.operation,
        desired_state: requested,
        risk: "device_control",
      }],
    },
  };
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
