import { supabaseAdmin } from "../supabase/supabaseClient";
import { publishSourceIntelligenceEvent } from "./sourceEventPublisher";
import { transitionWorkflow } from "./workflows";

export type VerificationState = "pending" | "verified" | "failed" | "timeout";

async function finish(workflow: any | null | undefined, state: VerificationState, summary: string, metadata: Record<string, unknown>) {
  if (workflow?.id) {
    await transitionWorkflow({ workflow, status: state === "verified" ? "verified" : "failed", agent_id: workflow.responsible_agent || "oyi", summary, metadata: { verification_state: state, ...metadata } });
  }
  await publishSourceIntelligenceEvent({
    source: "edge",
    surface: "api",
    event_type: `verification.${state}`,
    category: "workflow",
    estate_id: workflow?.estate_id || null,
    home_id: workflow?.home_id || null,
    entity_type: "workflow",
    entity_id: workflow?.workflow_id || null,
    entity_label: workflow?.title || "Operational verification",
    severity: state === "verified" ? "info" : "attention",
    title: state === "verified" ? "Workflow verified" : "Workflow verification failed",
    summary,
    payload: metadata,
  }, { source_table: "ochiga_workflows", source_event_id: workflow?.workflow_id ? `${workflow.workflow_id}:verification:${state}` : undefined });
  return { state, summary, metadata };
}

// Wave 5 Slice 3 -- real physical-state verification. The prior
// implementation read the legacy device_states table with
// Object.entries(expected_state || {}).every(...), so a caller that never
// supplied a meaningful expected_state (every current caller) vacuously
// got matches:true. The canonical truth for "did this command physically
// land" already exists -- ai_execution_ledger, written by
// executeDeviceCommandForActor's dispatch and later updated by
// deviceRuntimeStateService's own expected-vs-observed comparison
// (commandConfirmation(), which itself already fails closed: a command
// with zero comparable keys can never resolve to "confirmed", only to
// confirmation_timed_out). This function now consumes that one ledger
// record via command_execution_id instead of independently reconstructing
// a second, weaker definition of "verified".
export async function verifyDeviceAction(input: { workflow?: any; device_id: string; command_execution_id?: string | null }) {
  if (!input.command_execution_id) {
    // No traceable execution record (e.g. a provider path that has not
    // yet been wired to return one) -- honestly unknown, never a fabricated
    // pass. Reuses the existing "pending" state; no new state invented.
    return finish(input.workflow, "pending", "No command execution record was available to verify the device's physical state against.", { device_id: input.device_id, reason: "command_execution_id_missing" });
  }
  const { getDeviceCommandExecution } = await import("../services/deviceCommandExecutionStore");
  const execution = await getDeviceCommandExecution(input.command_execution_id).catch(() => null);
  if (!execution) {
    return finish(input.workflow, "pending", "The device command execution record was not found.", { device_id: input.device_id, command_execution_id: input.command_execution_id, reason: "execution_record_missing" });
  }
  const meta = { device_id: input.device_id, command_execution_id: input.command_execution_id, confirmation_status: execution.confirmation_status, expected_state: execution.expected_state, observed_state: execution.observed_state };
  if (execution.confirmation_status === "state_confirmed" && execution.expected_state && Object.keys(execution.expected_state).length > 0) {
    return finish(input.workflow, "verified", "Device physical state was confirmed by the canonical execution ledger.", meta);
  }
  if (execution.confirmation_status === "state_mismatch") {
    return finish(input.workflow, "failed", "Device physical state did not match the expected command.", meta);
  }
  if (execution.confirmation_status === "confirmation_timed_out") {
    return finish(input.workflow, "timeout", "Device physical state confirmation timed out.", meta);
  }
  // awaiting_state_confirmation (the common case -- executeDeviceCommandForActor
  // returns before physical confirmation completes), not_observable (IR/
  // provider_ack_only devices with no observable confirmation channel), or
  // any other non-terminal value: dispatch may have succeeded, but physical
  // state is not yet (or never can be) confirmed. Honest "pending", never a
  // fabricated verified:true.
  return finish(input.workflow, "pending", "The device command was accepted but its physical state is not yet confirmed.", meta);
}

export async function verifyVisitorStatus(input: { workflow?: any; visitor_id: string; expected_status: string }) {
  const { data, error } = await supabaseAdmin.from("visitor_access").select("status,updated_at").eq("id", input.visitor_id).maybeSingle();
  const matches = !error && String(data?.status || "").toLowerCase() === String(input.expected_status).toLowerCase();
  return finish(input.workflow, matches ? "verified" : error ? "timeout" : "failed", matches ? "Visitor status was verified." : "Visitor status could not be verified.", { visitor_id: input.visitor_id, expected_status: input.expected_status, observed_status: data?.status || null, reason: error?.message || null });
}

export async function verifyMaintenanceStatus(input: { workflow?: any; request_id: string; expected_status: string }) {
  const { data, error } = await supabaseAdmin.from("maintenance_requests").select("status,updated_at").eq("id", input.request_id).maybeSingle();
  const matches = !error && String(data?.status || "").toLowerCase() === String(input.expected_status).toLowerCase();
  return finish(input.workflow, matches ? "verified" : error ? "timeout" : "failed", matches ? "Maintenance status was verified." : "Maintenance status could not be verified.", { request_id: input.request_id, expected_status: input.expected_status, observed_status: data?.status || null, reason: error?.message || null });
}

export async function verifyServiceStatus(input: { workflow?: any; service_key: string; home_id?: string | null }) {
  const { data, error } = await supabaseAdmin.from("service_registry_events").select("event_type,created_at").eq("service_key", input.service_key).eq("home_id", input.home_id || "").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return finish(input.workflow, !error && data ? "verified" : error ? "timeout" : "failed", !error && data ? "Service status was verified from the registry." : "Service status could not be verified.", { service_key: input.service_key, home_id: input.home_id || null, latest_event: data || null, reason: error?.message || null });
}

export async function verifyWorkflowCompletion(workflow: any) {
  const status = String(workflow?.workflow_status || "").toLowerCase();
  return finish(workflow, ["completed", "verified"].includes(status) ? "verified" : "pending", ["completed", "verified"].includes(status) ? "Workflow completion is verified." : "Workflow is not complete yet.", { workflow_status: status });
}
