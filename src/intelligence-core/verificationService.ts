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

export async function verifyDeviceAction(input: { workflow?: any; device_id: string; expected_state?: Record<string, unknown> | null }) {
  const { data, error } = await supabaseAdmin.from("device_states").select("state,updated_at").eq("device_id", input.device_id).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) return finish(input.workflow, "timeout", "Device state was not available for verification.", { device_id: input.device_id, reason: error?.message || "state_missing" });
  const state = data.state || {};
  const expected = input.expected_state || {};
  const matches = Object.entries(expected).every(([key, value]) => state[key] === value);
  return finish(input.workflow, matches ? "verified" : "failed", matches ? "Device state matches the confirmed command." : "Device state does not match the expected command.", { device_id: input.device_id, expected_state: expected, observed_state: state, observed_at: data.updated_at || null });
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
