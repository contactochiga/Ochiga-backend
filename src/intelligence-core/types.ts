export const OCHIGA_INTELLIGENCE_CORE_ID = "ochiga_intelligence_core" as const;

export type IntelligenceAgentId =
  | "oyi"
  | "oma"
  | "osa"
  | "facility"
  | "edge"
  | "camera"
  | "watch"
  | "ochiga_executive"
  | "twin"
  | "plan_studio";

export type IntelligenceMemoryScope =
  | "user"
  | "home"
  | "estate"
  | "facility"
  | "office"
  | "lead"
  | "camera"
  | "edge"
  | "employee"
  | "team"
  | "department"
  | "company"
  | "system";

export type IntelligenceRiskLevel = "low" | "medium" | "high" | "critical";

export type IntelligenceToolCategory =
  | "read"
  | "write"
  | "action"
  | "high-risk"
  | "disabled"
  | "external"
  | "marketing"
  | "sales"
  | "camera"
  | "facility"
  | "edge";

export type IntelligenceEventCategory =
  | "operational"
  | "security"
  | "maintenance"
  | "visitor"
  | "device"
  | "utility"
  | "wallet"
  | "service"
  | "automation"
  | "workflow"
  | "prediction"
  | "office"
  | "lead"
  | "support"
  | "community"
  | "marketing"
  | "sales"
  | "camera"
  | "edge"
  | "system";

export type IntelligenceSurface =
  | "consumer"
  | "facility"
  | "office"
  | "edge"
  | "camera"
  | "watch"
  | "website"
  | "whatsapp"
  | "widget"
  | "api"
  | "twin"
  | "plan_studio"
  | "oma"
  | "osa";

export type IntelligenceAgentDefinition = {
  id: IntelligenceAgentId;
  name: string;
  domain: string;
  allowed_surfaces: IntelligenceSurface[];
  tools: string[];
  memory_scope: IntelligenceMemoryScope[];
  risk_level: IntelligenceRiskLevel;
  default_response_tone: string;
};

export type IntelligenceToolDefinition = {
  id: string;
  source: "oyi" | "office" | "edge" | "shared";
  description: string;
  categories: IntelligenceToolCategory[];
  required_permissions: string[];
  confirmation_required: boolean;
  enabled: boolean;
  risk_level: IntelligenceRiskLevel;
  allowed_agents: IntelligenceAgentId[];
};

export type IntelligenceContext = {
  core_id: typeof OCHIGA_INTELLIGENCE_CORE_ID;
  agent_id: IntelligenceAgentId;
  surface: IntelligenceSurface;
  actor_id?: string | null;
  user_id?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
  office_id?: string | null;
  lead_id?: string | null;
  camera_id?: string | null;
  edge_node_id?: string | null;
  permissions: string[];
  metadata: Record<string, unknown>;
};

export type IntelligenceMemoryRecord = {
  scope: IntelligenceMemoryScope;
  key: string;
  value: Record<string, unknown>;
  actor_id?: string | null;
  user_id?: string | null;
  estate_id?: string | null;
  home_id?: string | null;
  office_id?: string | null;
  lead_id?: string | null;
  camera_id?: string | null;
  edge_node_id?: string | null;
};

export type IntelligenceEvent = {
  id?: string;
  actor_id?: string | null;
  agent_id: IntelligenceAgentId;
  surface: IntelligenceSurface;
  estate_id?: string | null;
  home_id?: string | null;
  office_id?: string | null;
  camera_id?: string | null;
  event_type: string;
  category: IntelligenceEventCategory | string;
  title: string;
  summary: string;
  confidence: "confirmed" | "probable" | "possible" | "unknown";
  source: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
};

export type IntelligenceResponse = {
  message: string;
  response_mode?: "answer" | "insight" | "action" | "dashboard";
  cards?: unknown[];
  sources?: unknown[];
  suggested_actions?: unknown[];
  confirmations?: unknown[];
  metadata?: Record<string, unknown>;
};

export type IntelligenceAdapter = {
  agent: IntelligenceAgentDefinition;
  getContext(input: Partial<IntelligenceContext>): Promise<IntelligenceContext>;
  getAllowedTools(context: IntelligenceContext): Promise<IntelligenceToolDefinition[]>;
  writeMemory(context: IntelligenceContext, memory: IntelligenceMemoryRecord): Promise<{ ok: boolean; skipped?: boolean; reason?: string }>;
  writeTimelineEvent(context: IntelligenceContext, event: IntelligenceEvent): Promise<{ ok: boolean; skipped?: boolean; reason?: string }>;
  formatResponse(context: IntelligenceContext, response: IntelligenceResponse): IntelligenceResponse;
};
