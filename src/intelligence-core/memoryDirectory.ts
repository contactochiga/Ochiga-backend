import type { IntelligenceAgentId } from "./types";

export type IntelligenceMemoryDirectoryScope =
  | "resident"
  | "lead"
  | "estate"
  | "facility"
  | "camera"
  | "edge"
  | "office"
  | "employee"
  | "team"
  | "department"
  | "company";

export type IntelligenceMemoryDirectoryEntry = {
  scope: IntelligenceMemoryDirectoryScope;
  owner_hint: string;
  agents: IntelligenceAgentId[];
  storage: string[];
  boundary: string;
  visibility: "private" | "scoped" | "shared" | "system";
};

export const INTELLIGENCE_MEMORY_DIRECTORY: IntelligenceMemoryDirectoryEntry[] = [
  {
    scope: "resident",
    owner_hint: "user_id + home_id + estate_id",
    agents: ["oyi", "watch"],
    storage: ["resident_memory", "home_timeline", "ochiga_intelligence_events"],
    boundary: "Resident memory remains scoped to the resident and active home. It must not be merged into office, marketing, sales, or facility memory.",
    visibility: "private",
  },
  {
    scope: "lead",
    owner_hint: "lead_id or conversation identity",
    agents: ["oma", "osa"],
    storage: ["office lead memory", "ochiga_memory_directory", "ochiga_intelligence_events"],
    boundary: "Lead memory may contain commercial context only. It must not include resident-private home telemetry unless explicitly permissioned.",
    visibility: "scoped",
  },
  {
    scope: "estate",
    owner_hint: "estate_id",
    agents: ["facility", "camera", "edge", "oyi"],
    storage: ["home_timeline", "camera_events", "device_events", "ochiga_intelligence_events"],
    boundary: "Estate operational memory is scoped to the estate and role permissions. Private home details remain hidden unless the actor has permission.",
    visibility: "scoped",
  },
  {
    scope: "facility",
    owner_hint: "estate_id + facility role",
    agents: ["facility"],
    storage: ["facility operational tables", "ochiga_intelligence_events"],
    boundary: "Facility memory supports operations, residents, devices, maintenance, visitors, and cameras by role permission only.",
    visibility: "scoped",
  },
  {
    scope: "camera",
    owner_hint: "camera_id + estate_id/home_id",
    agents: ["camera", "edge", "facility"],
    storage: ["camera_events", "camera_ai_profiles", "ochiga_intelligence_events"],
    boundary: "Camera memory stores stream health and event facts. It must not expose streams/events outside camera access policy.",
    visibility: "scoped",
  },
  {
    scope: "edge",
    owner_hint: "edge_node_id",
    agents: ["edge", "camera"],
    storage: ["edge runtime health", "camera registry snapshots", "ochiga_intelligence_events"],
    boundary: "Edge memory is local-runtime and health oriented. It must never expose local secrets or DVR credentials.",
    visibility: "system",
  },
  {
    scope: "office",
    owner_hint: "office_id or workspace identity",
    agents: ["oma", "osa", "ochiga_executive", "plan_studio", "twin"],
    storage: ["office CRM/task/document memory", "ochiga_memory_directory", "ochiga_intelligence_events"],
    boundary: "Office memory is commercial and operational. It must consume Oyi data through explicit adapters and permissions only.",
    visibility: "scoped",
  },
  {
    scope: "employee",
    owner_hint: "employee_id + user_id",
    agents: ["ochiga_executive"],
    storage: ["ochiga_organization_employees", "ochiga_agent_observability"],
    boundary: "Employee memory is organizational only. It must not include resident-private memory or raw CRM notes.",
    visibility: "scoped",
  },
  {
    scope: "team",
    owner_hint: "team_id",
    agents: ["ochiga_executive"],
    storage: ["ochiga_organization_teams", "ochiga_agent_collaborations", "ochiga_agent_observability"],
    boundary: "Team memory summarizes responsibility and workflow activity only. It must not merge home, estate, resident, or lead memory.",
    visibility: "scoped",
  },
  {
    scope: "department",
    owner_hint: "department_id",
    agents: ["ochiga_executive"],
    storage: ["ochiga_organization_departments", "ochiga_organization_responsibilities", "ochiga_agent_collaborations"],
    boundary: "Department memory is organizational coordination context. Executive Intelligence receives summaries, not raw private source memory.",
    visibility: "scoped",
  },
  {
    scope: "company",
    owner_hint: "company",
    agents: ["ochiga_executive"],
    storage: ["ochiga_intelligence_events", "ochiga_intelligence_predictions", "ochiga_agent_collaborations"],
    boundary: "Company memory is cross-system summary memory. It must not directly expose resident memory, OMA lead notes, OSA customer notes, or camera credentials.",
    visibility: "scoped",
  },
];

export function getMemoryDirectory(agentId?: IntelligenceAgentId | string | null) {
  if (!agentId) return INTELLIGENCE_MEMORY_DIRECTORY;
  return INTELLIGENCE_MEMORY_DIRECTORY.filter((entry) => entry.agents.includes(agentId as IntelligenceAgentId));
}
