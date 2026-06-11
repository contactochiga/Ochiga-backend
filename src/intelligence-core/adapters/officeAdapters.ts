import { getIntelligenceAgent } from "../agentRegistry";
import { BaseIntelligenceAdapter } from "./baseAdapter";

export class OmaAdapter extends BaseIntelligenceAdapter {
  constructor() {
    const agent = getIntelligenceAgent("oma");
    if (!agent) throw new Error("OMA intelligence agent is not registered");
    super(agent, null);
  }
}

export class OsaAdapter extends BaseIntelligenceAdapter {
  constructor() {
    const agent = getIntelligenceAgent("osa");
    if (!agent) throw new Error("OSA intelligence agent is not registered");
    super(agent, null);
  }
}
