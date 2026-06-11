import type { AuthUser } from "../../middleware/auth";
import { getIntelligenceAgent } from "../agentRegistry";
import { BaseIntelligenceAdapter } from "./baseAdapter";

export class FacilityAdapter extends BaseIntelligenceAdapter {
  constructor(actor?: AuthUser | null) {
    const agent = getIntelligenceAgent("facility");
    if (!agent) throw new Error("Facility intelligence agent is not registered");
    super(agent, actor);
  }
}
