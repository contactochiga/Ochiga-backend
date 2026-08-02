import { randomUUID } from "crypto";
import type { OyiAction, OyiActionStatus } from "../contracts/action";
import type { OyiWorkflow } from "../contracts/workflow";
import type { CanonicalTarget } from "../contracts/target";
import { actionIdempotencyKey } from "./ActionIdempotency";
import { assertActionTransition, isTerminalActionStatus } from "./ActionStateMachine";

function nowIso() {
  return new Date().toISOString();
}

export function createActionForWorkflow(input: {
  workflow: OyiWorkflow;
  actorId: string | null;
  target: CanonicalTarget;
  requestedOperation: string;
  requestedState: unknown;
}): OyiAction {
  return {
    action_id: randomUUID(),
    workflow_id: input.workflow.workflow_id,
    domain: input.workflow.domain,
    target: input.target,
    requested_operation: input.requestedOperation,
    requested_state: input.requestedState,
    status: "awaiting_confirmation",
    idempotency_key: actionIdempotencyKey({
      actorId: input.actorId,
      threadId: input.workflow.thread_id,
      target: input.target,
      operation: input.requestedOperation,
      requestedState: input.requestedState,
    }),
    approved_at: null,
    executed_at: null,
    completed_at: null,
    execution_id: null,
    verification_id: null,
    result: null,
    evidence: [],
  };
}

export function transitionAction(action: OyiAction, status: OyiActionStatus, result: Record<string, unknown> | null = null): OyiAction {
  if (isTerminalActionStatus(action.status)) return action;
  assertActionTransition(action.status, status);
  const now = nowIso();
  return {
    ...action,
    status,
    approved_at: status === "approved" ? now : action.approved_at,
    executed_at: ["queued", "sent", "provider_accepted", "provider_rejected"].includes(status) ? now : action.executed_at,
    completed_at: isTerminalActionStatus(status) ? now : action.completed_at,
    result,
  };
}
