import { supabaseAdmin } from "../supabase/supabaseClient";
import { INTELLIGENCE_AGENTS } from "./agentRegistry";
import { INTELLIGENCE_TOOL_REGISTRY } from "./toolRegistry";
import { INTELLIGENCE_MEMORY_DIRECTORY } from "./memoryDirectory";
import { AGENT_COLLABORATION_RULES } from "./collaboration";
import { getAgentObservabilitySummary } from "./observability";
import { AGENT_RESPONSIBILITY_CONTRACTS, WORKFLOW_CONTRACTS } from "./workflows";
import { EXECUTION_REGISTRY } from "./executionRegistry";
import { getAgentCapabilityRegistry } from "./agentCapabilities";

async function tableHealth(table: string) {
  const { error } = await supabaseAdmin.from(table).select("id", { count: "exact", head: true }).limit(1);
  return { table, ok: !error, warning: error?.message || null };
}

export async function getIntelligenceHealth() {
  const [events, observability, memoryDirectory, agentObservability] = await Promise.all([
    tableHealth("ochiga_intelligence_events"),
    tableHealth("ochiga_agent_observability"),
    tableHealth("ochiga_memory_directory"),
    getAgentObservabilitySummary(100),
  ]);
  const predictions = await tableHealth("ochiga_intelligence_predictions");
  const [departments, teams, roles, employees, collaborations] = await Promise.all([
    tableHealth("ochiga_organization_departments"),
    tableHealth("ochiga_organization_teams"),
    tableHealth("ochiga_organization_roles"),
    tableHealth("ochiga_organization_employees"),
    tableHealth("ochiga_agent_collaborations"),
  ]);
  const [workflows, workflowEvents, agentResponsibilities] = await Promise.all([
    tableHealth("ochiga_workflows"),
    tableHealth("ochiga_workflow_events"),
    tableHealth("ochiga_agent_responsibilities"),
  ]);

  const components = {
    agents: { ok: INTELLIGENCE_AGENTS.length >= 7, count: INTELLIGENCE_AGENTS.length },
    tools: { ok: INTELLIGENCE_TOOL_REGISTRY.length > 0, count: INTELLIGENCE_TOOL_REGISTRY.length },
    memory_directory: { ok: INTELLIGENCE_MEMORY_DIRECTORY.length >= 7 && memoryDirectory.ok, count: INTELLIGENCE_MEMORY_DIRECTORY.length, table: memoryDirectory },
    event_bus: events,
    predictions: { ...predictions, engine_ready: predictions.ok },
    organization: { ok: departments.ok && teams.ok && roles.ok && employees.ok, departments, teams, roles, employees },
    observability,
    collaboration: { ok: AGENT_COLLABORATION_RULES.every((rule) => rule.enabled) && collaborations.ok, count: AGENT_COLLABORATION_RULES.length, table: collaborations },
    workflows: {
      ok: workflows.ok && workflowEvents.ok && agentResponsibilities.ok,
      workflow_contracts: WORKFLOW_CONTRACTS.length,
      responsibility_contracts: AGENT_RESPONSIBILITY_CONTRACTS.length,
      tables: { workflows, workflowEvents, agentResponsibilities },
      safety: "Workflow orchestration is tracking and recommendation only. High-risk device, payment, access, wallet, and permission actions remain blocked without explicit approval.",
    },
    execution: {
      ok: EXECUTION_REGISTRY.some((action) => action.available),
      registered: EXECUTION_REGISTRY.length,
      available: EXECUTION_REGISTRY.filter((action) => action.available).map((action) => action.id),
      safety: "All registered actions require explicit confirmation; unavailable actions remain in their existing module workflow.",
    },
    agent_capabilities: { ok: getAgentCapabilityRegistry().length >= 7, count: getAgentCapabilityRegistry().length },
  };

  const checks = [components.agents.ok, components.tools.ok, components.memory_directory.ok, components.event_bus.ok, components.predictions.ok, components.organization.ok, components.observability.ok, components.collaboration.ok, components.workflows.ok, components.execution.ok, components.agent_capabilities.ok];
  const readiness = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  return {
    ok: readiness >= 80,
    core_id: "ochiga_intelligence_core",
    readiness_score: readiness,
    classification: readiness >= 95 ? "RC Foundation" : readiness >= 80 ? "Beta" : "Early Beta",
    components,
    agent_observability: agentObservability,
  };
}
