import type { AuthUser } from "../../middleware/auth";
import { writeScopedMemory } from "../memory";
import { publishIntelligenceEvent } from "../eventBus";
import { writeHomeTimelineFromCore } from "../timeline";
import type { IntelligenceContext, IntelligenceEvent, IntelligenceMemoryRecord, IntelligenceResponse } from "../types";
import { getIntelligenceAgent } from "../agentRegistry";
import { BaseIntelligenceAdapter } from "./baseAdapter";

export class OyiAdapter extends BaseIntelligenceAdapter {
  constructor(actor: AuthUser) {
    const agent = getIntelligenceAgent("oyi");
    if (!agent) throw new Error("Oyi intelligence agent is not registered");
    super(agent, actor);
  }

  async writeMemory(context: IntelligenceContext, memory: IntelligenceMemoryRecord) {
    return writeScopedMemory(this.actor as AuthUser, context, memory);
  }

  async writeTimelineEvent(_context: IntelligenceContext, event: IntelligenceEvent) {
    const timeline = await writeHomeTimelineFromCore(this.actor as AuthUser, event);
    const bus = await publishIntelligenceEvent(event);
    return timeline.ok ? { ...timeline, intelligence_event: bus } : timeline;
  }

  formatResponse(context: IntelligenceContext, response: IntelligenceResponse): IntelligenceResponse {
    const base = super.formatResponse(context, response);
    return {
      ...base,
      message: String(base.message || "").replace(/\b(database|tool registry|route name|audit event)\b/gi, "home update"),
    };
  }
}
