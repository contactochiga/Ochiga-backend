import type { CanonicalConversationRequest, OperationalObject } from "../../runtime/canonicalConversationRuntime";

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
