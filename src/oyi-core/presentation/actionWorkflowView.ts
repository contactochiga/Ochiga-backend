// Intelligence System Visibility, Slice 4 -- Actions & Workflows. A
// read-only cross-source presentation layer over governed work that
// already lives in FOUR distinct canonical stores with different
// storage models -- mirrors humanInterventionView.ts's own "one
// composing function over real per-source loaders" pattern. Nothing
// here executes, confirms, or mutates anything; every write still
// belongs exclusively to its own authoritative system.
//
// Sources included, each already-authoritative and already-queryable
// through an EXISTING or newly-added narrow read accessor on its own
// canonical store (see the Slice 4 additions to CommunicationRuntime,
// deviceCommandExecutionStore, facilityAutomationService,
// WorkflowRepository):
//   - Communications (oyi_communications via CommunicationRuntime).
//   - Device command execution (ai_execution_ledger, filtered to real
//     device.command.* rows via executionLedger.ts's own
//     isGenuineDeviceCommand classifier -- the SAME canonical "device
//     command truth model" deviceCommandExecutionStore.ts already
//     exposes for a single command via getDeviceCommandExecution).
//   - Facility automation approvals/executions (automation_approvals).
//   - Conversation workflows (oyi_conversation_workflows).
//
// Sources deliberately excluded (documented, not silently dropped):
//   - Office governed action proposals (officeActionProposal.ts) --
//     same reason conversation_proposal is excluded from
//     humanInterventionView.ts's platform variant: the only storage is
//     a JSONB sibling key on oyi_conversation_threads.metadata, with no
//     index that makes an unscoped platform-wide scan safe.
//   - Goal plan-step dispatch -- represented within Goals & Decisions
//     (each goal's own execution_history), not duplicated here. A
//     step's dispatch through Communications or a device command
//     already appears as its own row under the source that actually
//     executed it; folding goal-plan-step dispatch in here too would
//     double-count the same real action under two source_types.
import { communicationRuntime } from "../../services/communicationRuntime/CommunicationRuntime";
import type { CommunicationRecord } from "../../contracts/communication";
import { listGenuineDeviceCommandExecutions } from "../../services/deviceCommandExecutionStore";
import { listAutomationApprovalsByStatuses } from "../../services/facilityAutomationService";
import { SupabaseWorkflowRepository } from "../workflows/WorkflowRepository";

export type ActionSourceType = "communication" | "device_command" | "facility_automation" | "conversation_workflow";

// Section 9's normalized conceptual lifecycle. Never overwrites the
// real canonical_status carried alongside it -- see NormalizedActionItem.
export type ActionPresentationStage =
  | "proposed"
  | "waiting_confirmation"
  | "confirmed"
  | "executing"
  | "executed"
  | "verified"
  | "cancelled"
  | "failed"
  | "timed_out";

export type NormalizedActionItem = {
  id: string; // `${source_type}:${source_id}` -- derived from the authoritative source, never minted
  source_type: ActionSourceType;
  source_id: string;
  title: string;
  canonical_status: string;
  presentation_stage: ActionPresentationStage;
  worker: string | null; // surface-derived; null when the source carries no OyiSurface-vocabulary field (honest, not guessed)
  created_at: string;
  updated_at: string;
};

export type ActionSourceHealth = { source_type: ActionSourceType; queried: boolean; ok: boolean; error: string | null; count: number };
export type ActionAggregateResult = { items: NormalizedActionItem[]; sources: ActionSourceHealth[]; complete: boolean };

const SURFACE_LABEL: Record<string, string> = {
  office_internal: "Oma",
  public_corporate: "Osa",
  facility: "Facility",
  consumer: "Consumer",
};

// ---------------------------------------------------------------------
// Presentation-stage mappings -- one per source, each grounded in that
// source's own real, grep-verified status vocabulary (see the module
// header's citations). A status not explicitly listed resolves to the
// most honest available bucket, never silently to "executed"/"verified".
// ---------------------------------------------------------------------

export function communicationStage(status: string): ActionPresentationStage {
  switch (status) {
    case "draft": return "proposed";
    case "awaiting_confirmation": return "waiting_confirmation";
    case "confirmed": return "confirmed";
    case "queued":
    case "sending": return "executing";
    case "sent":
    case "delivered":
    case "read": return "executed";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "expired": return "timed_out";
    default: return "proposed";
  }
}

// Device command lifecycle (deviceCommandExecutionStore.ts's own
// CommandLifecycleStatus) -- the most precise of the four vocabularies.
// state_confirmed is the ONLY status this maps to "verified": every
// other terminal state is honestly short of physical confirmation, per
// Section 10's own "a provider-accepted command is NOT automatically a
// verified physical effect" instruction.
export function deviceCommandStage(status: string): ActionPresentationStage {
  switch (status) {
    case "requested":
    case "validated": return "proposed";
    case "accepted_for_processing":
    case "dispatching": return "confirmed";
    case "provider_accepted":
    case "awaiting_state_confirmation": return "executing";
    case "state_confirmed": return "verified";
    case "state_mismatch": return "failed"; // physical state CONTRADICTED the command -- a real failure, not a pending state
    case "confirmation_timed_out": return "timed_out";
    case "provider_rejected":
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    default: return "proposed";
  }
}

// automation_approvals' own real status vocabulary (facilityAutomationService.ts,
// grep-verified: pending_approval / executing / succeeded /
// verification_failed / failed / rejected / expired).
export function facilityAutomationStage(status: string): ActionPresentationStage {
  switch (status) {
    case "pending_approval": return "waiting_confirmation";
    case "executing": return "executing";
    case "succeeded": return "verified";
    case "verification_failed":
    case "failed": return "failed";
    case "rejected": return "cancelled";
    case "expired": return "timed_out";
    default: return "waiting_confirmation";
  }
}

// OyiWorkflow's own WorkflowStatus (contracts/workflow.ts). "answered"/
// "completed" map to "executed" (not "verified" -- a read-shaped
// workflow answering a question was never a physical action needing
// verification; an action-shaped one reaching "completed" is honestly
// the ceiling this source can claim without a device-command-level
// truth model underneath it).
export function conversationWorkflowStage(status: string): ActionPresentationStage {
  switch (status) {
    case "collecting_inputs":
    case "awaiting_clarification": return "proposed";
    case "ready_for_review":
    case "awaiting_approval": return "waiting_confirmation";
    case "approved": return "confirmed";
    case "executing":
    case "verifying": return "executing";
    case "answered":
    case "completed": return "executed";
    case "cancelled":
    case "superseded": return "cancelled";
    case "expired": return "timed_out";
    default: return "failed"; // empty/unavailable/unsupported/permission_restricted/failed
  }
}

// Communication title deliberately built from channel+intent ONLY --
// never subject/body/recipient (see Section 11: CommunicationRecord's
// recipient carries name/email/phone/whatsapp_phone; subject/body/
// plain_text/html carry the actual message). Mirrors Slice 2's own
// communicationTitle() in humanInterventionView.ts exactly.
function communicationTitle(record: Pick<CommunicationRecord, "channel" | "intent">): string {
  const intent = String(record.intent || "").trim();
  return intent ? `${record.channel}: ${intent}` : `A pending ${record.channel} message`;
}

async function loadCommunicationActions(limit: number): Promise<{ health: ActionSourceHealth; items: NormalizedActionItem[] }> {
  try {
    const statuses: CommunicationRecord["status"][] = [
      "draft", "awaiting_confirmation", "confirmed", "queued", "sending", "sent", "delivered", "read", "failed", "cancelled", "expired",
    ];
    const records = await communicationRuntime.listByStatuses(statuses, limit);
    const items: NormalizedActionItem[] = records.map((r) => ({
      id: `communication:${r.communication_id}`,
      source_type: "communication",
      source_id: r.communication_id,
      title: communicationTitle(r),
      canonical_status: String(r.status),
      presentation_stage: communicationStage(String(r.status)),
      worker: SURFACE_LABEL[r.surface] || null,
      created_at: r.created_at,
      updated_at: r.delivered_at || r.sent_at || r.completed_at || r.created_at,
    }));
    return { health: { source_type: "communication", queried: true, ok: true, error: null, count: items.length }, items };
  } catch (error: any) {
    return { health: { source_type: "communication", queried: true, ok: false, error: String(error?.message || error), count: 0 }, items: [] };
  }
}

async function loadDeviceCommandActions(limit: number): Promise<{ health: ActionSourceHealth; items: NormalizedActionItem[] }> {
  try {
    const records = await listGenuineDeviceCommandExecutions(limit);
    const items: NormalizedActionItem[] = records.map((r: any) => {
      const status = String(r.final_status || r.confirmation_status || r.provider_status || r.dispatch_status || r.request_status || "requested");
      return {
        id: `device_command:${r.command_execution_id}`,
        source_type: "device_command" as const,
        source_id: String(r.command_execution_id),
        title: r.command_key ? `Device command: ${r.command_key}` : "A device command",
        canonical_status: status,
        presentation_stage: deviceCommandStage(status),
        // ai_execution_ledger carries no OyiSurface-vocabulary field --
        // honestly omitted, never guessed from provider/origin.
        worker: null,
        created_at: String(r.requested_at || ""),
        updated_at: String(r.completed_at || r.requested_at || ""),
      };
    });
    return { health: { source_type: "device_command", queried: true, ok: true, error: null, count: items.length }, items };
  } catch (error: any) {
    return { health: { source_type: "device_command", queried: true, ok: false, error: String(error?.message || error), count: 0 }, items: [] };
  }
}

async function loadFacilityAutomationActions(limit: number): Promise<{ health: ActionSourceHealth; items: NormalizedActionItem[] }> {
  try {
    const rows = await listAutomationApprovalsByStatuses(
      ["pending_approval", "executing", "succeeded", "verification_failed", "failed", "rejected", "expired"],
      limit
    );
    const items: NormalizedActionItem[] = rows.map((row: any) => ({
      id: `facility_automation:${row.id}`,
      source_type: "facility_automation",
      source_id: String(row.id),
      title: String(row.target_label || `${row.action_id || "automation"} on ${row.entity_type || "an entity"}`),
      canonical_status: String(row.status),
      presentation_stage: facilityAutomationStage(String(row.status)),
      worker: "Facility",
      created_at: String(row.created_at || ""),
      updated_at: String(row.decided_at || row.executed_at || row.created_at || ""),
    }));
    return { health: { source_type: "facility_automation", queried: true, ok: true, error: null, count: items.length }, items };
  } catch (error: any) {
    return { health: { source_type: "facility_automation", queried: true, ok: false, error: String(error?.message || error), count: 0 }, items: [] };
  }
}

const workflowRepositoryForActions = new SupabaseWorkflowRepository();

async function loadConversationWorkflowActions(limit: number): Promise<{ health: ActionSourceHealth; items: NormalizedActionItem[] }> {
  try {
    const rows = await workflowRepositoryForActions.listRecent(limit);
    const items: NormalizedActionItem[] = rows.map((w) => ({
      id: `conversation_workflow:${w.workflow_id}`,
      source_type: "conversation_workflow",
      source_id: w.workflow_id,
      title: w.operation || w.capability_key || "A conversation workflow",
      canonical_status: String(w.status),
      presentation_stage: conversationWorkflowStage(String(w.status)),
      worker: SURFACE_LABEL[w.surface] || null,
      created_at: w.created_at,
      updated_at: w.updated_at,
    }));
    return { health: { source_type: "conversation_workflow", queried: true, ok: true, error: null, count: items.length }, items };
  } catch (error: any) {
    return { health: { source_type: "conversation_workflow", queried: true, ok: false, error: String(error?.message || error), count: 0 }, items: [] };
  }
}

// The one platform-wide entry point -- Office's Actions & Workflows page
// calls this exclusively. Parallel reads across all four sources;
// complete=false if any source's own query failed, so a caller never
// presents a partial list as "nothing is happening."
export async function loadPlatformActionAggregate(limit = 50): Promise<ActionAggregateResult> {
  const results = await Promise.all([
    loadCommunicationActions(limit),
    loadDeviceCommandActions(limit),
    loadFacilityAutomationActions(limit),
    loadConversationWorkflowActions(limit),
  ]);
  const items: NormalizedActionItem[] = [];
  const sources: ActionSourceHealth[] = [];
  for (const result of results) {
    sources.push(result.health);
    items.push(...result.items);
  }
  items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return { items, sources, complete: sources.every((s) => s.ok) };
}
