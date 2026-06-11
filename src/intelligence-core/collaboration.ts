import type { IntelligenceAgentId } from "./types";
import { normalizeIntelligenceCategory } from "./eventBus";

export type AgentCollaborationRule = {
  id: string;
  from: IntelligenceAgentId;
  to: IntelligenceAgentId;
  trigger: string;
  purpose: string;
  enabled: boolean;
};

export const AGENT_COLLABORATION_RULES: AgentCollaborationRule[] = [
  {
    id: "camera_facility_oyi",
    from: "camera",
    to: "facility",
    trigger: "camera security/attention event",
    purpose: "Facility reviews camera events and escalates resident-visible impacts to Oyi when appropriate.",
    enabled: true,
  },
  {
    id: "oma_osa",
    from: "oma",
    to: "osa",
    trigger: "qualified marketing lead",
    purpose: "OMA qualifies inbound interest; OSA handles sales follow-up and demo/proposal workflow.",
    enabled: true,
  },
  {
    id: "facility_edge",
    from: "facility",
    to: "edge",
    trigger: "stream/device runtime issue",
    purpose: "Facility requests Edge runtime diagnostics for local camera/device problems.",
    enabled: true,
  },
  {
    id: "watch_oyi",
    from: "watch",
    to: "oyi",
    trigger: "compact wrist awareness or action",
    purpose: "Watch surfaces compact status while Oyi owns resident-facing home context.",
    enabled: true,
  },
];

export function getCollaborationHints(events: any[]) {
  const hints = new Set<string>();
  for (const event of events) {
    const category = normalizeIntelligenceCategory(event.category);
    const agent = String(event.agent_id || "");
    if (agent === "camera" || category === "camera") hints.add("camera_facility_oyi");
    if (agent === "oma" || category === "marketing") hints.add("oma_osa");
    if (agent === "facility" || category === "edge") hints.add("facility_edge");
    if (agent === "watch" || String(event.surface || "") === "watch") hints.add("watch_oyi");
  }
  return AGENT_COLLABORATION_RULES.filter((rule) => hints.has(rule.id));
}
