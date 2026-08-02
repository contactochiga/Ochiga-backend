import { randomUUID } from "crypto";
import type { OyiWorkflow, WorkflowStatus } from "../contracts/workflow";
import type { ResolvedTurn } from "../contracts/resolvedTurn";
import { assertWorkflowTransition, isTerminalWorkflowStatus } from "./WorkflowStateMachine";

function nowIso() {
  return new Date().toISOString();
}

export function createWorkflowForTurn(turn: ResolvedTurn, status: WorkflowStatus = "collecting_inputs"): OyiWorkflow {
  const now = nowIso();
  return {
    workflow_id: randomUUID(),
    thread_id: turn.thread_id || randomUUID(),
    request_id: turn.request_id,
    capability_key: turn.capability_key,
    domain: (turn.domain || "global") as OyiWorkflow["domain"],
    operation: turn.operation,
    status,
    target: turn.target,
    inputs: {},
    unresolved_inputs: [],
    authority_decision: turn.authority,
    proposed_action: null,
    execution_record: null,
    evidence: [],
    revision: 1,
    created_at: now,
    updated_at: now,
    expires_at: null,
  };
}

export function transitionWorkflow(workflow: OyiWorkflow, status: WorkflowStatus): OyiWorkflow {
  if (isTerminalWorkflowStatus(workflow.status)) return workflow;
  assertWorkflowTransition(workflow.status, status);
  return { ...workflow, status, revision: workflow.revision + 1, updated_at: nowIso() };
}
