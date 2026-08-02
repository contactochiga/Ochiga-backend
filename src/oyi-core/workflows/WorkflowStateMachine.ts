import type { WorkflowStatus } from "../contracts/workflow";

const TERMINAL: WorkflowStatus[] = ["answered", "empty", "unavailable", "unsupported", "permission_restricted", "completed", "failed", "cancelled", "expired", "superseded"];

const ALLOWED: Record<WorkflowStatus, WorkflowStatus[]> = {
  collecting_inputs: ["awaiting_clarification", "ready_for_review", "cancelled", "expired", "superseded"],
  awaiting_clarification: ["collecting_inputs", "ready_for_review", "cancelled", "expired", "superseded"],
  ready_for_review: ["awaiting_approval", "collecting_inputs", "cancelled", "expired", "superseded"],
  awaiting_approval: ["approved", "cancelled", "expired", "superseded"],
  approved: ["executing", "cancelled", "superseded"],
  executing: ["verifying", "failed", "superseded"],
  verifying: ["completed", "failed", "answered", "empty", "unavailable", "unsupported", "permission_restricted"],
  answered: [],
  empty: [],
  unavailable: [],
  unsupported: [],
  permission_restricted: [],
  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
  superseded: [],
};

export function isTerminalWorkflowStatus(status: WorkflowStatus) {
  return TERMINAL.includes(status);
}

export function canTransitionWorkflow(from: WorkflowStatus, to: WorkflowStatus) {
  return ALLOWED[from]?.includes(to) || false;
}

export function assertWorkflowTransition(from: WorkflowStatus, to: WorkflowStatus) {
  if (!canTransitionWorkflow(from, to)) {
    throw new Error(`Invalid workflow transition: ${from} -> ${to}`);
  }
}
