import type { AuthUser } from "../../middleware/auth";
import type {
  IntelligenceAdapter,
  IntelligenceAgentDefinition,
  IntelligenceContext,
  IntelligenceEvent,
  IntelligenceMemoryRecord,
  IntelligenceResponse,
  IntelligenceSurface,
} from "../types";
import { OCHIGA_INTELLIGENCE_CORE_ID } from "../types";
import { getToolsForAgent } from "../toolRegistry";
import { publishIntelligenceEvent } from "../eventBus";

export abstract class BaseIntelligenceAdapter implements IntelligenceAdapter {
  constructor(public readonly agent: IntelligenceAgentDefinition, protected readonly actor?: AuthUser | null) {}

  async getContext(input: Partial<IntelligenceContext>): Promise<IntelligenceContext> {
    return {
      core_id: OCHIGA_INTELLIGENCE_CORE_ID,
      agent_id: this.agent.id,
      surface: (input.surface || this.agent.allowed_surfaces[0] || "api") as IntelligenceSurface,
      actor_id: input.actor_id || this.actor?.id || null,
      user_id: input.user_id || this.actor?.id || null,
      estate_id: input.estate_id || this.actor?.estate_id || null,
      home_id: input.home_id || this.actor?.home_id || null,
      office_id: input.office_id || null,
      lead_id: input.lead_id || null,
      camera_id: input.camera_id || null,
      edge_node_id: input.edge_node_id || null,
      permissions: input.permissions || [],
      metadata: input.metadata || {},
    };
  }

  async getAllowedTools(context: IntelligenceContext) {
    const available = getToolsForAgent(context.agent_id);
    const permissions = new Set(context.permissions || []);
    return available.filter((tool) => {
      if (!tool.enabled) return true;
      return tool.required_permissions.every((permission) => permissions.has(permission));
    });
  }

  async writeMemory(
    _context: IntelligenceContext,
    _memory: IntelligenceMemoryRecord
  ): ReturnType<IntelligenceAdapter["writeMemory"]> {
    return { ok: false, skipped: true, reason: "adapter_memory_not_configured" };
  }

  async writeTimelineEvent(
    context: IntelligenceContext,
    event: IntelligenceEvent
  ): ReturnType<IntelligenceAdapter["writeTimelineEvent"]> {
    return publishIntelligenceEvent({
      ...event,
      actor_id: event.actor_id || context.actor_id || null,
      agent_id: event.agent_id || this.agent.id,
      surface: event.surface || context.surface,
      estate_id: event.estate_id || context.estate_id || null,
      home_id: event.home_id || context.home_id || null,
      office_id: event.office_id || context.office_id || null,
      camera_id: event.camera_id || context.camera_id || null,
    });
  }

  formatResponse(_context: IntelligenceContext, response: IntelligenceResponse): IntelligenceResponse {
    return {
      ...response,
      metadata: {
        ...(response.metadata || {}),
        core_id: OCHIGA_INTELLIGENCE_CORE_ID,
        agent_id: this.agent.id,
      },
    };
  }
}
