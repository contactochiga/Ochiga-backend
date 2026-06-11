import { getIntelligenceAgent } from "../agentRegistry";
import { BaseIntelligenceAdapter } from "./baseAdapter";

export class EdgeAdapter extends BaseIntelligenceAdapter {
  constructor() {
    const agent = getIntelligenceAgent("edge");
    if (!agent) throw new Error("Edge intelligence agent is not registered");
    super(agent, null);
  }
}
