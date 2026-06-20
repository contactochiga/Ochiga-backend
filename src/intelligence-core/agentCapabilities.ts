import { INTELLIGENCE_AGENTS } from "./agentRegistry";
import { getToolsForAgent } from "./toolRegistry";
import { getOyiSurfaceDefinition } from "./surfaceRegistry";

export function getAgentCapabilityRegistry() {
  return INTELLIGENCE_AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    domains: agent.domain,
    tools: getToolsForAgent(agent.id).map((tool) => tool.id),
    memory_scope: agent.memory_scope,
    event_categories: Array.from(new Set(agent.allowed_surfaces.flatMap((surface) => getOyiSurfaceDefinition(surface).event_categories))),
    permissions: Array.from(new Set(getToolsForAgent(agent.id).flatMap((tool) => tool.required_permissions))),
  }));
}
