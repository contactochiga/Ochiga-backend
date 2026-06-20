/** Workflow-first awareness ranking used by Oyi awareness services. */
export function rankActiveWorkflowsForAwareness(workflows: any[]) {
  const weights: Record<string, number> = { security_incident: 100, camera_incident: 95, visitor_access: 75, maintenance: 70, service_request: 65, wallet_action: 60, community_moderation: 55 };
  return (workflows || [])
    .filter((workflow) => !["verified", "completed", "cancelled"].includes(String(workflow.workflow_status || "")))
    .map((workflow) => ({ ...workflow, awareness_priority: (weights[String(workflow.workflow_type || "")] || 40) + (workflow.workflow_priority === "critical" ? 30 : workflow.workflow_priority === "high" ? 15 : 0) + (workflow.workflow_status === "escalated" ? 20 : 0) }))
    .sort((a, b) => b.awareness_priority - a.awareness_priority);
}
