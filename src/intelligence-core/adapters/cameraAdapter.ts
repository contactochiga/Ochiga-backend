import type { AuthUser } from "../../middleware/auth";
import { getIntelligenceAgent } from "../agentRegistry";
import { BaseIntelligenceAdapter } from "./baseAdapter";

export class CameraAdapter extends BaseIntelligenceAdapter {
  constructor(actor?: AuthUser | null) {
    const agent = getIntelligenceAgent("camera");
    if (!agent) throw new Error("Camera intelligence agent is not registered");
    super(agent, actor);
  }
}
