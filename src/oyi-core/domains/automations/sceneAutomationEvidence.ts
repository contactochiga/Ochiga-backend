import { supabaseAdmin } from "../../../supabase/supabaseClient";
import { logger } from "../../../observability/logger";
import type { OisContext } from "../../../types/oisContext";
import type { CanonicalConversationRequest, IntelligenceFact, OperationalObject } from "../../contracts/canonicalConversation";
import type { IntelligenceRequestContract } from "../../interpretation/conversationIntentRouting";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function listOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(recordOf).filter((item) => Object.keys(item).length) : [];
}

function actionCount(value: unknown) {
  return listOf(value).length;
}

export function sceneAutomationRecordsFromContext(object: OperationalObject | null, input: CanonicalConversationRequest) {
  const relationships = recordOf(object?.relationships);
  const context = recordOf(input.context);
  const conversationContext = recordOf(input.conversation_context);
  const rows = [
    ...listOf(relationships.scenes),
    ...listOf(relationships.active_scenes),
    ...listOf(relationships.automations),
    ...listOf(relationships.active_automations),
    ...listOf(context.scenes),
    ...listOf(context.automations),
    ...listOf(conversationContext.scenes),
    ...listOf(conversationContext.automations),
    ...(object?.object_type === "scene" || object?.object_type === "automation" ? [recordOf({
      id: object.canonical_id,
      name: object.label,
      object_type: object.object_type,
      enabled: object.current_state,
      actions: recordOf(object.metadata).actions,
      trigger: recordOf(object.metadata).trigger,
      last_run_status: recordOf(object.metadata).last_run_status || object.health,
    })] : []),
  ];
  return rows.map((row) => ({
    id: text(row.id || row.scene_id || row.automation_id),
    object_type: text(row.object_type || row.type) || (row.trigger ? "automation" : "scene"),
    name: text(row.name || row.title || row.label) || null,
    enabled: row.enabled === undefined ? null : Boolean(row.enabled),
    trigger: recordOf(row.trigger),
    condition: recordOf(row.condition),
    action_count: actionCount(row.actions),
    last_run_at: text(row.last_run_at || row.last_execution_at) || null,
    last_run_status: text(row.last_run_status || row.execution_status || row.status) || null,
    next_run_at: text(row.next_run_at) || null,
    metadata: row,
  }));
}

export function sceneAutomationExecutionBoundary() {
  return {
    conversation_store: ["oyi_conversation_threads", "oyi_conversation_messages"],
    configuration_store: ["consumer_scenes", "consumer_automations"],
    execution_store: ["audit_events", "consumer_automation_runs", "device_command_executions"],
    execution_owner: "scene_routes_and_canonical_device_command_pipeline",
  };
}

function currentScope(input: CanonicalConversationRequest, oisContext: OisContext | null | undefined) {
  return {
    estate_id: input.estate_id || oisContext?.estate_id || null,
    home_id: input.home_id || oisContext?.home_id || null,
  };
}

// The IntelligenceFact.value shape below intentionally matches
// sceneAutomationRecordsFromContext's normalized record shape (id,
// object_type, name, enabled, trigger, condition, action_count,
// last_run_at, last_run_status, next_run_at) so the existing
// buildSceneAutomationReadAnswer(records, domain) presentation builder can
// be reused unchanged against real evidence, not just context-derived
// records.
function unavailableSceneAutomationFact(input: {
  objectType: "scene" | "automation" | "automation_run";
  scope: ReturnType<typeof currentScope>;
  reason: string;
  contract: IntelligenceRequestContract;
}): IntelligenceFact {
  const now = new Date().toISOString();
  return {
    fact_id: `${input.objectType}-unavailable:${input.contract.conversation_request_id}`,
    domain: "automations",
    fact_type: input.objectType,
    scope: { estate_id: input.scope.estate_id, home_id: input.scope.home_id, room_id: null },
    object: { object_type: input.objectType, canonical_id: input.scope.home_id || "unknown-home", label: input.objectType },
    statement: `${input.objectType} evidence is unavailable right now.`,
    value: { id: null, object_type: input.objectType, name: null, reason: input.reason },
    previous_value: null,
    occurred_at: null,
    observed_at: now,
    source_type: "database",
    source_id: null,
    truth_state: "unavailable",
    confidence: 0,
    freshness: "unavailable",
    privacy_class: "household_private",
    permissions: [input.objectType === "scene" ? "scenes.read" : "automations.read"],
    evidence: [{ type: input.objectType, status: "unavailable", reason: input.reason }],
  };
}

function sceneFromRow(row: Record<string, unknown>, scope: ReturnType<typeof currentScope>): IntelligenceFact {
  const name = text(row.name) || "Scene";
  return {
    fact_id: `scene:${row.id}`,
    domain: "automations",
    fact_type: "scene",
    scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || scope.home_id, room_id: null },
    object: { object_type: "scene", canonical_id: String(row.id), label: name },
    statement: `${name}: ${row.enabled ? "enabled" : "disabled"}, ${actionCount(row.actions)} actions.`,
    value: {
      id: String(row.id),
      object_type: "scene",
      name,
      enabled: Boolean(row.enabled),
      trigger: {},
      condition: {},
      action_count: actionCount(row.actions),
      last_run_at: null,
      last_run_status: null,
      next_run_at: null,
    },
    previous_value: null,
    occurred_at: text(row.updated_at) || null,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: String(row.id),
    truth_state: "confirmed",
    confidence: 0.9,
    freshness: text(row.updated_at) || "historical",
    privacy_class: "household_private",
    permissions: ["scenes.read"],
    evidence: [{ type: "consumer_scenes", id: row.id }],
  };
}

function automationFromRow(row: Record<string, unknown>, scope: ReturnType<typeof currentScope>): IntelligenceFact {
  const name = text(row.name) || "Automation";
  const lastStatus = text(row.last_run_status) || null;
  return {
    fact_id: `automation:${row.id}`,
    domain: "automations",
    fact_type: "automation",
    scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || scope.home_id, room_id: null },
    object: { object_type: "automation", canonical_id: String(row.id), label: name },
    statement: `${name}: ${row.enabled ? "enabled" : "disabled"}${lastStatus ? `, last run ${lastStatus}` : ""}.`,
    value: {
      id: String(row.id),
      object_type: "automation",
      name,
      enabled: Boolean(row.enabled),
      trigger: recordOf(row.trigger),
      condition: {},
      action_count: actionCount(row.actions),
      last_run_at: row.last_run_at || null,
      last_run_status: lastStatus,
      next_run_at: row.next_run_at || null,
    },
    previous_value: null,
    occurred_at: text(row.updated_at) || null,
    observed_at: new Date().toISOString(),
    source_type: "database",
    source_id: String(row.id),
    truth_state: "confirmed",
    confidence: 0.9,
    freshness: text((row.last_run_at as string) || (row.updated_at as string)) || "historical",
    privacy_class: "household_private",
    permissions: ["automations.read"],
    evidence: [{ type: "consumer_automations", id: row.id }],
  };
}

// Direct evidence: consumer_scenes — enabled state + action count. Scenes
// have no run-history table of their own (see loadAutomationRunFacts for
// the table that does).
export async function loadSceneFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  const isFacilitySurface = input.surface === "facility";
  if (isFacilitySurface ? !scope.estate_id : !scope.home_id) return [];
  const diagnosticBase = { capability_key: "scenes.list.read", surface: input.surface, estate_id: scope.estate_id, home_id: scope.home_id };
  try {
    let query = supabaseAdmin.from("consumer_scenes").select("id,estate_id,home_id,name,actions,enabled,updated_at").order("updated_at", { ascending: false }).limit(50);
    query = isFacilitySurface ? query.eq("estate_id", scope.estate_id) : query.eq("home_id", scope.home_id);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any) => sceneFromRow(row, scope));
    logger.info("oyi_scene_evidence_loaded", { ...diagnosticBase, query_row_count: rows.length, fact_count: facts.length, result_type: facts.length ? "answered" : "empty" });
    return facts;
  } catch (error) {
    logger.warn("conversation_scene_load_failed", { ...diagnosticBase, error, result_type: "unavailable" });
    return [unavailableSceneAutomationFact({ objectType: "scene", scope, reason: "scene_query_failed", contract })];
  }
}

// Direct evidence: consumer_automations, including the Automation Runtime
// V2 columns (next_run_at/last_run_at/last_run_status/timezone).
export async function loadAutomationFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  const isFacilitySurface = input.surface === "facility";
  if (isFacilitySurface ? !scope.estate_id : !scope.home_id) return [];
  const diagnosticBase = { capability_key: "automations.list.read", surface: input.surface, estate_id: scope.estate_id, home_id: scope.home_id };
  try {
    let query = supabaseAdmin.from("consumer_automations").select("id,estate_id,home_id,name,trigger,actions,enabled,next_run_at,last_run_at,last_run_status,updated_at").order("updated_at", { ascending: false }).limit(50);
    query = isFacilitySurface ? query.eq("estate_id", scope.estate_id) : query.eq("home_id", scope.home_id);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any) => automationFromRow(row, scope));
    logger.info("oyi_automation_evidence_loaded", { ...diagnosticBase, query_row_count: rows.length, fact_count: facts.length, result_type: facts.length ? "answered" : "empty" });
    return facts;
  } catch (error) {
    logger.warn("conversation_automation_load_failed", { ...diagnosticBase, error, result_type: "unavailable" });
    return [unavailableSceneAutomationFact({ objectType: "automation", scope, reason: "automation_query_failed", contract })];
  }
}

// Direct evidence: consumer_automation_runs — the real run-history ledger
// (8-status enum, error_code/error_message for failures).
export async function loadAutomationRunFacts(
  input: CanonicalConversationRequest,
  oisContext: OisContext | null | undefined,
  contract: IntelligenceRequestContract,
): Promise<IntelligenceFact[]> {
  const scope = currentScope(input, oisContext);
  const isFacilitySurface = input.surface === "facility";
  if (isFacilitySurface ? !scope.estate_id : !scope.home_id) return [];
  const diagnosticBase = { capability_key: "automations.runs.read", surface: input.surface, estate_id: scope.estate_id, home_id: scope.home_id };
  try {
    let query = supabaseAdmin
      .from("consumer_automation_runs")
      .select("id,automation_id,estate_id,home_id,trigger_type,source,status,started_at,completed_at,error_code,error_message,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    query = isFacilitySurface ? query.eq("estate_id", scope.estate_id) : query.eq("home_id", scope.home_id);
    const { data, error } = await query;
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const facts = rows.map((row: any): IntelligenceFact => {
      const status = text(row.status) || "queued";
      return {
        fact_id: `automation-run:${row.id}`,
        domain: "automations",
        fact_type: "automation_run",
        scope: { estate_id: scope.estate_id, home_id: text(row.home_id) || scope.home_id, room_id: null },
        object: { object_type: "automation_run", canonical_id: String(row.id), label: `Run ${row.id}` },
        statement: `Run ${status}${row.error_message ? `: ${row.error_message}` : ""}.`,
        value: {
          automation_id: text(row.automation_id) || null,
          trigger_type: text(row.trigger_type) || null,
          source: text(row.source) || null,
          status,
          started_at: row.started_at || null,
          completed_at: row.completed_at || null,
          error_code: text(row.error_code) || null,
          error_message: text(row.error_message) || null,
        },
        previous_value: null,
        occurred_at: text(row.started_at || row.created_at) || null,
        observed_at: new Date().toISOString(),
        source_type: "database",
        source_id: String(row.id),
        truth_state: "confirmed",
        confidence: 0.9,
        freshness: text(row.completed_at || row.started_at) || "historical",
        privacy_class: "household_private",
        permissions: ["automations.read"],
        evidence: [{ type: "consumer_automation_runs", id: row.id, status }],
      };
    });
    logger.info("oyi_automation_run_evidence_loaded", { ...diagnosticBase, query_row_count: rows.length, fact_count: facts.length, result_type: facts.length ? "answered" : "empty" });
    return facts;
  } catch (error) {
    logger.warn("conversation_automation_run_load_failed", { ...diagnosticBase, error, result_type: "unavailable" });
    return [unavailableSceneAutomationFact({ objectType: "automation_run", scope, reason: "automation_run_query_failed", contract })];
  }
}
