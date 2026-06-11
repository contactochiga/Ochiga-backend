import type { AuthUser } from "../middleware/auth";
import { canonicalRole, hasPermission } from "../core/foundation";
import type { IntelligenceAgentId, IntelligenceEventCategory } from "./types";
import { normalizeIntelligenceCategory } from "./eventBus";

export type IntelligenceRole =
  | "resident"
  | "facility_manager"
  | "security_operator"
  | "estate_admin"
  | "ochiga_admin"
  | "super_admin"
  | "oma"
  | "osa";

export type IntelligencePermissionPolicy = {
  role: IntelligenceRole;
  allowed_categories: IntelligenceEventCategory[];
  allowed_agents: IntelligenceAgentId[];
  scope: "home" | "estate" | "office" | "system";
  can_view_office: boolean;
  can_view_camera: boolean;
  can_view_edge: boolean;
  can_view_private_home: boolean;
};

const ALL_CATEGORIES: IntelligenceEventCategory[] = [
  "operational",
  "security",
  "maintenance",
  "visitor",
  "community",
  "marketing",
  "sales",
  "camera",
  "edge",
  "system",
];

const ALL_AGENTS: IntelligenceAgentId[] = ["oyi", "oma", "osa", "facility", "edge", "camera", "watch", "twin", "plan_studio"];

export function normalizeIntelligenceRole(input?: string | null): IntelligenceRole {
  const raw = String(input || "resident").trim().toLowerCase();
  if (raw === "oma") return "oma";
  if (raw === "osa") return "osa";
  const canonical = canonicalRole(raw);
  if (canonical === "super_admin") return "super_admin";
  if (canonical === "ochiga_admin" || canonical === "ochiga_staff") return "ochiga_admin";
  if (canonical === "estate_admin") return "estate_admin";
  if (canonical === "facility_manager" || canonical === "maintenance_operator" || canonical === "finance_operator") return "facility_manager";
  if (canonical === "security_operator") return "security_operator";
  return "resident";
}

export function getIntelligencePermissionPolicy(actor?: AuthUser | null): IntelligencePermissionPolicy {
  const role = normalizeIntelligenceRole(actor?.role);
  if (role === "super_admin" || role === "ochiga_admin") {
    return {
      role,
      allowed_categories: ALL_CATEGORIES,
      allowed_agents: ALL_AGENTS,
      scope: role === "super_admin" ? "system" : "office",
      can_view_office: true,
      can_view_camera: true,
      can_view_edge: true,
      can_view_private_home: true,
    };
  }

  if (role === "oma") {
    return {
      role,
      allowed_categories: ["marketing", "sales", "system"],
      allowed_agents: ["oma", "osa"],
      scope: "office",
      can_view_office: true,
      can_view_camera: false,
      can_view_edge: false,
      can_view_private_home: false,
    };
  }

  if (role === "osa") {
    return {
      role,
      allowed_categories: ["sales", "marketing", "system"],
      allowed_agents: ["osa", "oma"],
      scope: "office",
      can_view_office: true,
      can_view_camera: false,
      can_view_edge: false,
      can_view_private_home: false,
    };
  }

  if (role === "estate_admin" || role === "facility_manager") {
    return {
      role,
      allowed_categories: ["operational", "security", "maintenance", "visitor", "community", "camera", "edge", "system"],
      allowed_agents: ["oyi", "facility", "edge", "camera", "watch"],
      scope: "estate",
      can_view_office: false,
      can_view_camera: hasPermission(actor, "cameras.view"),
      can_view_edge: true,
      can_view_private_home: role === "estate_admin",
    };
  }

  if (role === "security_operator") {
    return {
      role,
      allowed_categories: ["security", "visitor", "camera", "edge", "system"],
      allowed_agents: ["facility", "edge", "camera"],
      scope: "estate",
      can_view_office: false,
      can_view_camera: hasPermission(actor, "cameras.view"),
      can_view_edge: true,
      can_view_private_home: false,
    };
  }

  return {
    role: "resident",
    allowed_categories: ["operational", "security", "maintenance", "visitor", "community", "system"],
    allowed_agents: ["oyi", "watch"],
    scope: "home",
    can_view_office: false,
    can_view_camera: false,
    can_view_edge: false,
    can_view_private_home: true,
  };
}

export function filterEventsForActor(events: any[], actor?: AuthUser | null) {
  const policy = getIntelligencePermissionPolicy(actor);
  const actorEstate = actor?.estate_id || null;
  const actorHome = actor?.home_id || null;
  const actorId = actor?.id || null;

  return events.filter((event) => {
    const category = normalizeIntelligenceCategory(event.category);
    const agent = String(event.agent_id || "") as IntelligenceAgentId;
    if (!policy.allowed_categories.includes(category)) return false;
    if (agent && !policy.allowed_agents.includes(agent)) return false;
    if ((category === "marketing" || category === "sales") && !policy.can_view_office) return false;
    if (category === "camera" && !policy.can_view_camera) return false;
    if (category === "edge" && !policy.can_view_edge) return false;

    if (policy.scope === "system") return true;
    if (policy.scope === "office") return category === "marketing" || category === "sales" || event.office_id;
    if (policy.scope === "estate") return !event.estate_id || !actorEstate || String(event.estate_id) === String(actorEstate);

    const eventHome = event.home_id || event.metadata?.home_id || event.metadata?.payload?.home_id || null;
    const eventActor = event.actor_id || event.user_id || event.metadata?.user_id || null;
    if (eventHome && actorHome) return String(eventHome) === String(actorHome);
    if (eventActor && actorId) return String(eventActor) === String(actorId);
    if (event.estate_id && actorEstate && String(event.estate_id) !== String(actorEstate)) return false;
    return category === "community" || category === "system";
  });
}

export function applyRoleScopeToFilters(filters: any, actor?: AuthUser | null) {
  const policy = getIntelligencePermissionPolicy(actor);
  if (policy.scope === "home") {
    return { ...filters, estate_id: actor?.estate_id || filters.estate_id || null, home_id: actor?.home_id || filters.home_id || null };
  }
  if (policy.scope === "estate") {
    return { ...filters, estate_id: actor?.estate_id || filters.estate_id || null, home_id: filters.home_id || null };
  }
  if (policy.scope === "office") {
    return { ...filters, estate_id: null, home_id: null };
  }
  return filters;
}
