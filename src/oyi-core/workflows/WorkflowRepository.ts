import type { OyiWorkflow } from "../contracts/workflow";

export interface WorkflowRepository {
  getActive(threadId: string): Promise<OyiWorkflow | null>;
  save(workflow: OyiWorkflow): Promise<OyiWorkflow>;
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<string, OyiWorkflow>();

  async getActive(threadId: string) {
    return Array.from(this.workflows.values()).find((workflow) => workflow.thread_id === threadId && !["answered", "empty", "unavailable", "unsupported", "permission_restricted", "completed", "failed", "cancelled", "expired", "superseded"].includes(workflow.status)) || null;
  }

  async save(workflow: OyiWorkflow) {
    this.workflows.set(workflow.workflow_id, workflow);
    return workflow;
  }
}
