import type { PermissionKey } from "../core/foundation";

export type AiToolRiskLevel =
  | "public_read"
  | "authenticated_read"
  | "sensitive_write"
  | "infrastructure_control"
  | "admin";

export type AiScope = "office" | "facility" | "estate" | "home" | "user" | "public";

export type AiToolDefinition = {
  tool_id: string;
  description: string;
  category: string;
  risk_level: AiToolRiskLevel;
  requires_auth: boolean;
  required_permissions: PermissionKey[];
  confirmation_required: boolean;
  allowed_scopes: AiScope[];
  enabled: boolean;
};

export const AI_TOOL_REGISTRY: AiToolDefinition[] = [
  {
    tool_id: "summarize_estate",
    description: "Summarize the authenticated user's estate or estate-scoped operating context.",
    category: "operational_intelligence",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: ["estates.read"],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "summarize_devices",
    description: "Summarize visible device inventory, online/offline posture, and command readiness.",
    category: "operational_intelligence",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: ["devices.read"],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "summarize_support",
    description: "Summarize maintenance/support workload visible to the authenticated user.",
    category: "support_intelligence",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: ["support.read"],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "summarize_wallet",
    description: "Summarize wallet/service balance posture without mutating funds.",
    category: "financial_intelligence",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: ["wallets.read"],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "summarize_readiness",
    description: "Summarize production readiness, integration state, and missing operational signals.",
    category: "platform_intelligence",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: ["office.read"],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "open_module",
    description: "Open or route the UI to an authorized module without performing mutations.",
    category: "navigation",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: [],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "search_documents",
    description: "Search document metadata visible to the authenticated user.",
    category: "documents",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: ["documents.generate"],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "search_support",
    description: "Search support and maintenance records visible to the authenticated user.",
    category: "support_intelligence",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: ["support.read"],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "get_ai_status",
    description: "Return AI service, registry, ledger, and safety readiness.",
    category: "ai_operations",
    risk_level: "authenticated_read",
    requires_auth: true,
    required_permissions: [],
    confirmation_required: false,
    allowed_scopes: ["office", "facility", "estate", "home", "user"],
    enabled: true,
  },
  {
    tool_id: "device_command",
    description: "Request physical device control. Disabled in Phase 1 except ledger/confirmation scaffolding.",
    category: "infrastructure_control",
    risk_level: "infrastructure_control",
    requires_auth: true,
    required_permissions: ["devices.control"],
    confirmation_required: true,
    allowed_scopes: ["facility", "estate", "home", "user"],
    enabled: false,
  },
  {
    tool_id: "visitor_create",
    description: "Create visitor access. Disabled in Phase 1 except confirmation scaffolding.",
    category: "access_control",
    risk_level: "sensitive_write",
    requires_auth: true,
    required_permissions: ["visitors.create"],
    confirmation_required: true,
    allowed_scopes: ["facility", "estate", "home", "user"],
    enabled: false,
  },
  {
    tool_id: "support_mutation",
    description: "Create a support/maintenance record after explicit human confirmation.",
    category: "support_operations",
    risk_level: "sensitive_write",
    requires_auth: true,
    required_permissions: ["support.assign"],
    confirmation_required: true,
    allowed_scopes: ["office", "facility", "estate", "home"],
    enabled: true,
  },
  {
    tool_id: "wallet_mutation",
    description: "Fund, debit, or manage wallet balances. Disabled in Phase 1.",
    category: "financial_control",
    risk_level: "admin",
    requires_auth: true,
    required_permissions: ["wallets.manage"],
    confirmation_required: true,
    allowed_scopes: ["office", "facility", "estate", "home"],
    enabled: false,
  },
  {
    tool_id: "twin_control",
    description: "Control digital twin or mapped infrastructure objects. Disabled in Phase 1.",
    category: "digital_twin_control",
    risk_level: "infrastructure_control",
    requires_auth: true,
    required_permissions: ["twin.control"],
    confirmation_required: true,
    allowed_scopes: ["office", "facility", "estate"],
    enabled: false,
  },
  {
    tool_id: "admin_mutation",
    description: "Administrative changes to users, roles, settings, or integrations. Disabled in Phase 1.",
    category: "administration",
    risk_level: "admin",
    requires_auth: true,
    required_permissions: ["staff.manage", "settings.manage"],
    confirmation_required: true,
    allowed_scopes: ["office"],
    enabled: false,
  },
];

export function getAiTool(toolId: string) {
  return AI_TOOL_REGISTRY.find((tool) => tool.tool_id === toolId) || null;
}

export function enabledAiTools() {
  return AI_TOOL_REGISTRY.filter((tool) => tool.enabled);
}
