import { supabaseAdmin } from "../supabase/supabaseClient";
import { INTELLIGENCE_AGENTS } from "./agentRegistry";
import { INTELLIGENCE_TOOL_REGISTRY } from "./toolRegistry";
import { INTELLIGENCE_MEMORY_DIRECTORY } from "./memoryDirectory";
import { AGENT_COLLABORATION_RULES } from "./collaboration";
import { getAgentObservabilitySummary } from "./observability";

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

  const components = {
    agents: { ok: INTELLIGENCE_AGENTS.length >= 7, count: INTELLIGENCE_AGENTS.length },
    tools: { ok: INTELLIGENCE_TOOL_REGISTRY.length > 0, count: INTELLIGENCE_TOOL_REGISTRY.length },
    memory_directory: { ok: INTELLIGENCE_MEMORY_DIRECTORY.length >= 7 && memoryDirectory.ok, count: INTELLIGENCE_MEMORY_DIRECTORY.length, table: memoryDirectory },
    event_bus: events,
    observability,
    collaboration: { ok: AGENT_COLLABORATION_RULES.every((rule) => rule.enabled), count: AGENT_COLLABORATION_RULES.length },
  };

  const checks = [components.agents.ok, components.tools.ok, components.memory_directory.ok, components.event_bus.ok, components.observability.ok, components.collaboration.ok];
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
