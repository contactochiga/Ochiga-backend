import type { OyiWorkflow } from "../contracts/workflow";
import type { CanonicalTarget } from "../contracts/target";
import { logger } from "../../observability/logger";
import { supabaseAdmin } from "../../supabase/supabaseClient";

export interface WorkflowRepository {
  get(workflowId: string): Promise<OyiWorkflow | null>;
  getActive(threadId: string, actorId?: string | null): Promise<OyiWorkflow | null>;
  save(workflow: OyiWorkflow, options?: { expectedRevision?: number | null }): Promise<OyiWorkflow>;
  saveInput?(workflowId: string, input: { input_key: string; value: unknown; source: string; validated: boolean }): Promise<void>;
}

const terminalWorkflowStatuses = ["answered", "empty", "unavailable", "unsupported", "permission_restricted", "completed", "failed", "cancelled", "expired", "superseded"];
const activeWorkflowStatuses = ["collecting_inputs", "awaiting_clarification", "ready_for_review", "awaiting_approval", "approved", "executing", "verifying"];

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<string, OyiWorkflow>();
  private readonly inputs = new Map<string, Map<string, { value: unknown; source: string; validated: boolean }>>();

  async get(workflowId: string) {
    return this.workflows.get(workflowId) || null;
  }

  async getActive(threadId: string) {
    return Array.from(this.workflows.values()).find((workflow) => workflow.thread_id === threadId && !terminalWorkflowStatuses.includes(workflow.status)) || null;
  }

  async save(workflow: OyiWorkflow, options: { expectedRevision?: number | null } = {}) {
    const existing = this.workflows.get(workflow.workflow_id);
    if (options.expectedRevision != null && existing && existing.revision !== options.expectedRevision) {
      const error: any = new Error("Workflow revision conflict");
      error.code = "WORKFLOW_REVISION_CONFLICT";
      error.current = existing;
      throw error;
    }
    this.workflows.set(workflow.workflow_id, workflow);
    return workflow;
  }

  async saveInput(workflowId: string, input: { input_key: string; value: unknown; source: string; validated: boolean }) {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      workflow.inputs = { ...workflow.inputs, [input.input_key]: { value: input.value, source: input.source, validated: input.validated } };
      workflow.updated_at = new Date().toISOString();
      this.workflows.set(workflowId, workflow);
    }
    const current = this.inputs.get(workflowId) || new Map();
    current.set(input.input_key, { value: input.value, source: input.source, validated: input.validated });
    this.inputs.set(workflowId, current);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function targetFromRow(row: Record<string, any>): CanonicalTarget | null {
  if (!row.target_type || !row.target_id) return null;
  return {
    object_type: String(row.target_type),
    canonical_id: String(row.target_id),
    label: row.target_label || null,
    channel_code: row.target_channel_code || null,
    estate_id: row.estate_id || null,
    home_id: row.home_id || null,
    room_id: row.room_id || null,
  };
}

function workflowFromRow(row: Record<string, any>, inputs: Record<string, { value: unknown; source: string; validated: boolean }> = {}): OyiWorkflow {
  return {
    workflow_id: String(row.workflow_id),
    thread_id: String(row.thread_id || ""),
    request_id: String(row.request_id || ""),
    actor_id: row.actor_id || null,
    surface: String(row.surface || "consumer"),
    capability_key: String(row.capability_key || ""),
    domain: row.domain,
    operation: String(row.operation || ""),
    status: row.status,
    target: targetFromRow(row),
    inputs,
    unresolved_inputs: Array.isArray(row.unresolved_inputs) ? row.unresolved_inputs.map(String) : [],
    authority_decision: asRecord(row.authority_decision) as any || null,
    proposed_action: Object.keys(asRecord(row.proposed_action)).length ? asRecord(row.proposed_action) : null,
    execution_record: Object.keys(asRecord(row.execution_record)).length ? asRecord(row.execution_record) : null,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    metadata: asRecord(row.metadata),
    action_id: row.action_id || null,
    revision: Number(row.revision || 1),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    expires_at: row.expires_at || null,
    completed_at: row.completed_at || null,
    cancelled_at: row.cancelled_at || null,
    superseded_at: row.superseded_at || null,
  };
}

function workflowRow(workflow: OyiWorkflow) {
  return {
    workflow_id: workflow.workflow_id,
    thread_id: workflow.thread_id || null,
    actor_id: workflow.actor_id || null,
    surface: workflow.surface || "consumer",
    domain: workflow.domain,
    capability_key: workflow.capability_key,
    operation: workflow.operation,
    status: workflow.status,
    estate_id: workflow.target?.estate_id || null,
    building_id: null,
    home_id: workflow.target?.home_id || null,
    room_id: workflow.target?.room_id || null,
    target_type: workflow.target?.object_type || null,
    target_id: workflow.target?.canonical_id || null,
    target_label: workflow.target?.label || null,
    target_channel_code: workflow.target?.channel_code || null,
    revision: workflow.revision,
    unresolved_inputs: workflow.unresolved_inputs || [],
    authority_decision: workflow.authority_decision || null,
    proposed_action: workflow.proposed_action || null,
    execution_record: workflow.execution_record || null,
    evidence: workflow.evidence || [],
    metadata: workflow.metadata || {},
    action_id: workflow.action_id || null,
    request_id: workflow.request_id || null,
    expires_at: workflow.expires_at || null,
    updated_at: workflow.updated_at,
    completed_at: workflow.completed_at || null,
    cancelled_at: workflow.cancelled_at || null,
    superseded_at: workflow.superseded_at || null,
  };
}

export class SupabaseWorkflowRepository implements WorkflowRepository {
  async get(workflowId: string) {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_workflows")
      .select("*")
      .eq("workflow_id", workflowId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return workflowFromRow(data as any, await this.loadInputs(workflowId));
  }

  async getActive(threadId: string, actorId?: string | null) {
    let query = supabaseAdmin
      .from("oyi_conversation_workflows")
      .select("*")
      .eq("thread_id", threadId)
      .in("status", activeWorkflowStatuses)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (actorId) query = query.eq("actor_id", actorId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return workflowFromRow(data as any, await this.loadInputs(String((data as any).workflow_id)));
  }

  async save(workflow: OyiWorkflow, options: { expectedRevision?: number | null } = {}) {
    const row = workflowRow(workflow);
    if (options.expectedRevision != null) {
      const { data, error } = await supabaseAdmin
        .from("oyi_conversation_workflows")
        .update(row as any)
        .eq("workflow_id", workflow.workflow_id)
        .eq("revision", options.expectedRevision)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const current = await this.get(workflow.workflow_id);
        const conflict: any = new Error("Workflow revision conflict");
        conflict.code = "WORKFLOW_REVISION_CONFLICT";
        conflict.current = current;
        throw conflict;
      }
      logger.info("oyi_workflow_transitioned", {
        workflow_id: workflow.workflow_id,
        thread_id: workflow.thread_id,
        capability_key: workflow.capability_key,
        domain: workflow.domain,
        status: workflow.status,
        revision: workflow.revision,
      });
      return workflowFromRow(data as any, await this.loadInputs(workflow.workflow_id));
    }
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_workflows")
      .upsert(row as any, { onConflict: "workflow_id" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return workflowFromRow((data || row) as any, await this.loadInputs(workflow.workflow_id));
  }

  async saveInput(workflowId: string, input: { input_key: string; value: unknown; source: string; validated: boolean }) {
    const { error } = await supabaseAdmin
      .from("oyi_conversation_workflow_inputs")
      .upsert({
        workflow_id: workflowId,
        input_key: input.input_key,
        value: input.value === undefined ? null : input.value,
        source: input.source,
        validated: input.validated,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: "workflow_id,input_key" });
    if (error) throw error;
  }

  private async loadInputs(workflowId: string) {
    const { data, error } = await supabaseAdmin
      .from("oyi_conversation_workflow_inputs")
      .select("input_key,value,source,validated")
      .eq("workflow_id", workflowId);
    if (error) throw error;
    return Object.fromEntries((data || []).map((row: any) => [String(row.input_key), { value: row.value, source: String(row.source || "user"), validated: Boolean(row.validated) }]));
  }
}
