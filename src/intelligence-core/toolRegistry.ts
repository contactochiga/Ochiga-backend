import { AI_TOOL_REGISTRY } from "../ai/toolRegistry";
import type { IntelligenceAgentId, IntelligenceToolCategory, IntelligenceToolDefinition, IntelligenceRiskLevel } from "./types";

function categoryForOyiTool(tool: (typeof AI_TOOL_REGISTRY)[number]): IntelligenceToolCategory[] {
  const out = new Set<IntelligenceToolCategory>();
  if (!tool.enabled) out.add("disabled");
  if (tool.risk_level === "public_read" || tool.risk_level === "authenticated_read") out.add("read");
  if (tool.risk_level === "sensitive_write") out.add("write");
  if (tool.risk_level === "infrastructure_control") out.add("action");
  if (tool.risk_level === "admin") out.add("high-risk");
  if (/camera/i.test(tool.category) || /camera/i.test(tool.tool_id)) out.add("camera");
  if (/facility|estate|support|operational/i.test(tool.category)) out.add("facility");
  return Array.from(out.size ? out : new Set<IntelligenceToolCategory>(["read"]));
}

function riskForOyiTool(tool: (typeof AI_TOOL_REGISTRY)[number]): IntelligenceRiskLevel {
  if (!tool.enabled || tool.risk_level === "admin") return "critical";
  if (tool.risk_level === "infrastructure_control") return "high";
  if (tool.risk_level === "sensitive_write") return "medium";
  return "low";
}

function agentsForOyiTool(tool: (typeof AI_TOOL_REGISTRY)[number]): IntelligenceAgentId[] {
  const scopes = tool.allowed_scopes || [];
  const agents = new Set<IntelligenceAgentId>(["oyi"]);
  if (scopes.includes("facility") || scopes.includes("office")) agents.add("facility");
  if (/watch/i.test(tool.tool_id)) agents.add("watch");
  if (/camera|cctv/i.test(tool.tool_id) || /camera/i.test(tool.category)) agents.add("camera");
  return Array.from(agents);
}

export const OYI_CORE_TOOLS: IntelligenceToolDefinition[] = AI_TOOL_REGISTRY.map((tool) => ({
  id: `oyi:${tool.tool_id}`,
  source: "oyi",
  description: tool.description,
  categories: categoryForOyiTool(tool),
  required_permissions: tool.required_permissions,
  confirmation_required: tool.confirmation_required,
  enabled: tool.enabled,
  risk_level: riskForOyiTool(tool),
  allowed_agents: agentsForOyiTool(tool),
}));

export const OFFICE_CORE_TOOLS: IntelligenceToolDefinition[] = [
  {
    id: "office:create_lead",
    source: "office",
    description: "Create or update a lead record from a marketing conversation.",
    categories: ["write", "marketing", "external"],
    required_permissions: ["crm.manage"],
    confirmation_required: false,
    enabled: true,
    risk_level: "medium",
    allowed_agents: ["oma"],
  },
  {
    id: "office:update_lead_status",
    source: "office",
    description: "Update lead routing, status, score, and next action.",
    categories: ["write", "sales"],
    required_permissions: ["crm.manage"],
    confirmation_required: false,
    enabled: true,
    risk_level: "medium",
    allowed_agents: ["oma", "osa"],
  },
  {
    id: "office:get_solution_fit",
    source: "office",
    description: "Score fit for Ochiga/Oyi solutions from lead context.",
    categories: ["read", "marketing", "sales"],
    required_permissions: ["office.read"],
    confirmation_required: false,
    enabled: true,
    risk_level: "low",
    allowed_agents: ["oma", "osa"],
  },
  {
    id: "office:schedule_demo",
    source: "office",
    description: "Record a requested demo and prepare calendar links.",
    categories: ["write", "sales", "external"],
    required_permissions: ["crm.manage"],
    confirmation_required: false,
    enabled: true,
    risk_level: "medium",
    allowed_agents: ["osa"],
  },
  {
    id: "office:notify_founder",
    source: "office",
    description: "Escalate a commercial lead to the founder/human owner.",
    categories: ["action", "sales", "external"],
    required_permissions: ["office.manage"],
    confirmation_required: false,
    enabled: true,
    risk_level: "medium",
    allowed_agents: ["oma", "osa"],
  },
];

export const EDGE_CORE_TOOLS: IntelligenceToolDefinition[] = [
  {
    id: "edge:health",
    source: "edge",
    description: "Read Edge runtime, backend, and go2rtc health.",
    categories: ["read", "edge"],
    required_permissions: ["devices.read"],
    confirmation_required: false,
    enabled: true,
    risk_level: "low",
    allowed_agents: ["edge", "camera"],
  },
  {
    id: "edge:camera_registry",
    source: "edge",
    description: "Read camera registry contracts and generated stream mappings.",
    categories: ["read", "edge", "camera"],
    required_permissions: ["cameras.view"],
    confirmation_required: false,
    enabled: true,
    risk_level: "low",
    allowed_agents: ["edge", "camera"],
  },
  {
    id: "camera:event_ingest",
    source: "edge",
    description: "Submit verified camera events from Edge to backend camera event ingestion.",
    categories: ["write", "camera", "edge"],
    required_permissions: ["cameras.view"],
    confirmation_required: false,
    enabled: true,
    risk_level: "high",
    allowed_agents: ["edge", "camera"],
  },
];

export const INTELLIGENCE_TOOL_REGISTRY: IntelligenceToolDefinition[] = [
  ...OYI_CORE_TOOLS,
  ...OFFICE_CORE_TOOLS,
  ...EDGE_CORE_TOOLS,
];

export function getToolsForAgent(agentId: IntelligenceAgentId) {
  return INTELLIGENCE_TOOL_REGISTRY.filter((tool) => tool.allowed_agents.includes(agentId));
}
