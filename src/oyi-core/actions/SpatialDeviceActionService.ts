// Facility Spatial Mode Convergence, Foundation Slice 4 -- Governed
// Spatial Actions.
//
// Proves the governed action journey mirrors the read journey exactly:
// Spatial intent -> canonical_ref resolution -> Core capability/authority
// -> OyiAction -> existing domain execution -> verification -> canonical
// outcome. This module owns NO device transport, device state,
// verification or independent authority logic -- it is a thin
// translation from a resolved canonical device to the SAME
// ActionService/CapabilityService/DeviceConversationActionAdapter
// pipeline every conversational device command already runs through.
// Spatial Mode terminates in that one authoritative execution path; it
// never becomes a second device-control system.
//
// Traced production path this reuses verbatim:
//   capabilityRegistry "devices.power.control" (DeviceActionCapabilityModules.ts)
//     -> capabilityService.canUse() for authority (permission + scope)
//     -> workflowService.create()/.transition() for durable workflow state
//     -> actionService.create()/.approve()/.executeWithAdapter() for the
//        OyiAction state machine (idempotent create, mandatory approval
//        gate, queued->sent->provider_accepted/rejected->verifying->
//        confirmed/unobservable/timed_out/failed)
//     -> DeviceConversationActionAdapter (unmodified) -> executeDeviceCommandForActor
//        (the same physical device execution path used by conversational
//        commands)
//
// No SpatialActionAdapter was needed at the execution layer:
// DeviceConversationActionAdapter already accepts any OyiAction carrying
// a resolved CanonicalTarget, regardless of how that target was
// resolved. This file only prepares that OyiAction from a canonical_ref.
import type { AuthUser } from "../../middleware/auth";
import { supabaseAdmin } from "../../supabase/supabaseClient";
import { resolveCanonicalRef } from "../../services/canonicalReferenceResolver";
import { actionService, workflowService } from "../workflows/defaultWorkflowActionServices";
import { capabilityService } from "../capabilities/CapabilityService";
import { capabilityRegistry } from "../capabilities/CapabilityRegistry";
import { buildDeviceActionCapabilities } from "../capabilities/DeviceActionCapabilityModules";
import { DeviceConversationActionAdapter } from "../domains/devices/deviceActionAdapter";
import type { CanonicalTarget } from "../contracts/target";
import type { ResolvedTurn } from "../contracts/resolvedTurn";
import type { OyiAction, OyiActionStatus } from "../contracts/action";
import type { OyiWorkflow } from "../contracts/workflow";

// The one, real, production-registered device capability -- reused
// verbatim, never duplicated. Its own definition (permission_requirements:
// ["devices.control"], scope_requirements: home required,
// confirmation_policy: "explicit_confirmation", supported_surfaces
// including "facility") is exactly the authority this module composes.
export const SPATIAL_DEVICE_CAPABILITY_KEY = "devices.power.control";
export const SPATIAL_DEVICE_OPERATIONS = ["device.power.on", "device.power.off"] as const;
export type SpatialDeviceOperation = (typeof SPATIAL_DEVICE_OPERATIONS)[number];

const DEVICE_ACTION_SELECT = "id,estate_id,home_id,room_id,name,type,category,adapter,vendor,online,status";

// The device capability module is normally registered lazily by
// ConversationOrchestrator.ensureRegistered() (module-private, called on
// the first conversational turn). Spatial Mode must not depend on a
// conversational turn having happened first in this process -- registers
// the SAME builder function idempotently so authority is correct
// regardless of request ordering.
let registered = false;
function ensureDeviceCapabilityRegistered() {
  if (registered) return;
  if (!capabilityRegistry.get(SPATIAL_DEVICE_CAPABILITY_KEY)) {
    for (const capability of buildDeviceActionCapabilities()) capabilityRegistry.register(capability);
  }
  registered = true;
}

export type SpatialDeviceActionRequest = {
  estateId: string;
  canonicalRef: string;
  operation: SpatialDeviceOperation;
  channelCode?: string | null;
  confirm?: boolean;
  idempotencyKey?: string | null;
  actor: AuthUser;
};

export type SpatialDeviceActionOutcome = {
  action_id: string;
  workflow_id: string;
  capability_key: string;
  status: OyiActionStatus;
  target: CanonicalTarget;
  requested_operation: string;
  requested_state: unknown;
  result: Record<string, unknown> | null;
  safe_error: Record<string, unknown> | null;
};

export type SpatialDeviceActionResult =
  | { status: "not_found" }
  | { status: "ambiguous" }
  | { status: "unsupported"; reason: string }
  | { status: "permission_denied"; reason: string; required_permissions: string[] }
  | { status: "action"; outcome: SpatialDeviceActionOutcome };

function nowIso() {
  return new Date().toISOString();
}

function buildSyntheticTurn(input: {
  actor: AuthUser;
  capabilityKey: string;
  operation: string;
  target: CanonicalTarget;
  scope: { estate_id: string | null; building_id: string | null; home_id: string | null; room_id: string | null };
  authority: ReturnType<typeof capabilityService.canUse>;
}): ResolvedTurn {
  const now = nowIso();
  return {
    request_id: `spatial-${now}-${Math.random().toString(36).slice(2, 10)}`,
    correlation_id: `spatial-${input.target.canonical_id}`,
    runtime_id: "spatial_device_action",
    // Deliberately null, not a fabricated UUID -- oyi_conversation_workflows.
    // thread_id is a real FK to oyi_conversation_threads; a spatial action
    // has no conversation thread, and createWorkflowForTurn's own
    // `turn.thread_id || randomUUID()` fallback (WorkflowService.ts:18)
    // would otherwise synthesize a bogus UUID that violates that FK. The
    // explicit `{ thread_id: "" }` patch passed at the call site (not this
    // turn object) is what actually wins -- see initiateSpatialDeviceAction.
    thread_id: null,
    actor: { id: input.actor.id, role: input.actor.role, permissions: (input.actor as any).permissions },
    semantic_frame: {
      rawText: "",
      normalizedText: "",
      operation: input.operation as any,
      domain: "devices",
      primaryEntity: null,
      constraints: [],
      temporalScope: null,
      references: [],
      confidence: 1,
      ambiguity: { required: false, reason: null, candidates: [] },
      corrections: [],
      mutationIntent: true,
    },
    operation: input.operation,
    capability_key: input.capabilityKey,
    domain: "devices",
    scope: input.scope,
    target: input.target,
    target_source: "valid_reference",
    active_workflow_id: null,
    authority: {
      allowed: input.authority.allowed,
      tier: 1,
      approval_required: true,
      secure_review_required: false,
      required_permissions: input.authority.required_permissions,
      denial_reason: input.authority.reason,
    },
    temporal_scope: null,
    presentation_policy: { primary: "approval", allowed_supporting_blocks: ["text", "approval"], allowed_action_types: ["approval", "cancel"], suppress_awareness: true, suppress_context_chips: true, suppress_duplicate_status: true, snapshot_mode: "none", auto_navigation: false },
    context: { surface: "facility" } as any,
  };
}

function toOutcome(action: OyiAction): SpatialDeviceActionOutcome {
  return {
    action_id: action.action_id,
    workflow_id: action.workflow_id,
    capability_key: action.capability_key,
    status: action.status,
    target: action.target,
    requested_operation: action.requested_operation,
    requested_state: action.requested_state,
    result: action.result,
    safe_error: action.safe_error,
  };
}

// completed/failed is the same terminal-workflow mapping the
// conversational path uses (ConversationOrchestrator.ts,
// durableWorkflowContinuationResult): confirmed/unobservable -> completed,
// everything else terminal -> failed. Reused, not reinvented.
function terminalWorkflowStatusFor(actionStatus: OyiActionStatus): "completed" | "failed" {
  return actionStatus === "confirmed" || actionStatus === "unobservable" ? "completed" : "failed";
}

async function advanceWorkflowToTerminal(workflow: OyiWorkflow, finalAction: OyiAction) {
  // The full legal WorkflowStateMachine chain: awaiting_approval ->
  // approved -> executing -> verifying -> completed/failed. (Note:
  // ConversationOrchestrator.ts's own confirm handler transitions
  // awaiting_approval directly to completed/failed, which
  // WorkflowStateMachine's ALLOWED map does not permit -- see this
  // slice's final report. This function does not replicate that.)
  let current = workflow;
  current = await workflowService.transition(current, "approved");
  current = await workflowService.transition(current, "executing");
  current = await workflowService.transition(current, "verifying");
  current = await workflowService.transition(current, terminalWorkflowStatusFor(finalAction.status), {
    execution_record: { action_id: finalAction.action_id, action_status: finalAction.status, result: finalAction.result || null },
  });
  return current;
}

/**
 * Resolve a canonical_ref to a device and initiate (or confirm) a
 * governed device action through the existing ActionService/
 * CapabilityService/DeviceConversationActionAdapter pipeline.
 *
 * Devices only -- any other resolved entity_type returns "unsupported".
 * twin.control is NOT checked here; it gates entry to the spatial
 * surface at the route layer. This function enforces the SAME
 * underlying device authority (devices.control permission + home scope)
 * an equivalent conversational command would require, via
 * capabilityService.canUse("devices.power.control", ...) -- the actual
 * production authority gate, not a re-derived approximation of it.
 *
 * Without `confirm: true`, a fresh request always stops at
 * awaiting_confirmation -- it never auto-executes, matching
 * devices.power.control's confirmation_policy: "explicit_confirmation".
 * Idempotency is the existing ActionService guarantee: create() reuses
 * any still-active (non-terminal) action with the same actor/target/
 * operation/state, so a duplicate request never produces a duplicate
 * physical execution.
 */
export async function initiateSpatialDeviceAction(input: SpatialDeviceActionRequest): Promise<SpatialDeviceActionResult> {
  ensureDeviceCapabilityRegistered();

  const resolution = await resolveCanonicalRef(input.estateId, input.canonicalRef);
  if (resolution.status === "not_found") return { status: "not_found" };
  if (resolution.status === "ambiguous") return { status: "ambiguous" };
  if (resolution.entity_type !== "device" || !resolution.canonical_id) {
    return { status: "unsupported", reason: `Spatial actions are only supported for devices in this slice (resolved entity_type: ${resolution.entity_type ?? "unknown"}).` };
  }

  const { data: device, error } = await supabaseAdmin
    .from("devices")
    .select(DEVICE_ACTION_SELECT)
    .eq("id", resolution.canonical_id)
    .eq("estate_id", input.estateId)
    .maybeSingle();
  if (error) throw error;
  if (!device) return { status: "not_found" };

  const scope = { estate_id: input.estateId, building_id: null, home_id: (device as any).home_id || null, room_id: (device as any).room_id || null };
  const target: CanonicalTarget = {
    object_type: "device",
    canonical_id: String((device as any).id),
    label: (device as any).name || null,
    channel_code: input.channelCode || null,
    room_id: (device as any).room_id || null,
    home_id: (device as any).home_id || null,
    estate_id: input.estateId,
  };

  const authority = capabilityService.canUse(SPATIAL_DEVICE_CAPABILITY_KEY, { actor: input.actor, oisContext: null, surface: "facility", scope });
  if (!authority.allowed) {
    return { status: "permission_denied", reason: authority.reason || "not_allowed", required_permissions: authority.required_permissions };
  }

  const requestedState = input.operation === "device.power.on";
  const turn = buildSyntheticTurn({ actor: input.actor, capabilityKey: SPATIAL_DEVICE_CAPABILITY_KEY, operation: input.operation, target, scope, authority });

  let workflow = await workflowService.create(turn, "awaiting_approval", {
    // OyiWorkflow.thread_id is typed string (non-nullable), but
    // WorkflowRepository's own row mapping does `thread_id || null`
    // before writing to the DB -- "" produces the same genuine SQL NULL
    // as `null` would, without fighting the contract's type.
    thread_id: "",
    metadata: { spatial_origin: true, canonical_ref: resolution.canonical_ref, client_idempotency_key: input.idempotencyKey || null },
  });
  let action = await actionService.create({
    workflow,
    actorId: input.actor.id,
    target,
    requestedOperation: input.operation,
    requestedState,
  });
  if (action.workflow_id === workflow.workflow_id) {
    // A genuinely new action tied to the workflow just created above --
    // attach it, and use attachAction's own returned (revision-bumped)
    // workflow for every subsequent transition.
    workflow = await workflowService.attachAction(workflow, action.action_id);
  } else {
    // ActionService.create() found and reused an existing, still-active
    // action from an EARLIER request (the real idempotency guarantee --
    // see this slice's report). That action belongs to a DIFFERENT,
    // already-attached workflow; operate on that one instead. The fresh
    // workflow created above is simply left as an untouched,
    // never-attached awaiting_approval row.
    const owningWorkflow = await workflowService.get(action.workflow_id);
    if (owningWorkflow) workflow = owningWorkflow;
  }

  if (action.status !== "awaiting_confirmation" || !input.confirm) {
    // Either still genuinely awaiting confirmation (the default, safe
    // response for any request that did not explicitly confirm), or an
    // idempotent match already in flight (approved/queued/sent/etc from
    // a concurrent duplicate) -- report its real current status either
    // way, never re-approve/re-execute an action this call didn't
    // originate the confirmation for.
    return { status: "action", outcome: toOutcome(action) };
  }

  // Re-check authority at confirm time, exactly as
  // durableWorkflowContinuationResult does for the conversational
  // confirm turn -- an actor's permissions can change between the
  // initial spatial click and the confirmation click.
  const confirmAuthority = capabilityService.canUse(SPATIAL_DEVICE_CAPABILITY_KEY, { actor: input.actor, oisContext: null, surface: "facility", scope });
  if (!confirmAuthority.allowed) {
    return { status: "permission_denied", reason: confirmAuthority.reason || "not_allowed", required_permissions: confirmAuthority.required_permissions };
  }

  const approved = await actionService.approve(action, input.actor.id);
  const executed = await actionService.executeWithAdapter(approved, new DeviceConversationActionAdapter(input.actor, {
    estateId: scope.estate_id,
    homeId: scope.home_id,
    roomId: scope.room_id,
  }));
  await advanceWorkflowToTerminal(workflow, executed);

  return { status: "action", outcome: toOutcome(executed) };
}
