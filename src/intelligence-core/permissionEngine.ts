import type { AuthUser } from "../middleware/auth";
import { canonicalRole, hasPermission } from "../core/foundation";
import type { IntelligenceAgentId, IntelligenceEventCategory } from "./types";
import { normalizeIntelligenceCategory } from "./eventBus";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { canAccessCamera, cameraAccessActor } from "../modules/cameras/cameraAccess.policy";

export type IntelligenceRole =
  | "resident"
  | "facility_manager"
  | "security_operator"
  | "maintenance_operator"
  | "finance_operator"
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

const ALL_AGENTS: IntelligenceAgentId[] = ["oyi", "oma", "osa", "facility", "edge", "camera", "watch", "ochiga_executive", "twin", "plan_studio"];

export function normalizeIntelligenceRole(input?: string | null): IntelligenceRole {
  const raw = String(input || "resident").trim().toLowerCase();
  if (raw === "oma") return "oma";
  if (raw === "osa") return "osa";
  const canonical = canonicalRole(raw);
  if (canonical === "super_admin") return "super_admin";
  if (canonical === "ochiga_admin" || canonical === "ochiga_staff") return "ochiga_admin";
  if (canonical === "estate_admin") return "estate_admin";
  if (canonical === "facility_manager") return "facility_manager";
  if (canonical === "maintenance_operator") return "maintenance_operator";
  if (canonical === "finance_operator") return "finance_operator";
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
      allowed_agents: ["oyi", "facility", "edge", "camera", "watch", "ochiga_executive"],
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

  if (role === "maintenance_operator") {
    return {
      role,
      allowed_categories: ["operational", "maintenance", "system"],
      allowed_agents: ["oyi", "facility", "edge"],
      scope: "estate",
      can_view_office: false,
      can_view_camera: false,
      can_view_edge: false,
      can_view_private_home: false,
    };
  }

  if (role === "finance_operator") {
    return {
      role,
      allowed_categories: ["operational", "system"],
      allowed_agents: ["oyi", "facility"],
      scope: "estate",
      can_view_office: false,
      can_view_camera: false,
      can_view_edge: false,
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

// Wave 6 Slice 1 -- Privacy Boundary Closure. The role-level can_view_camera
// check below (e.g. facility_manager/security_operator holding ordinary
// cameras.view) is necessary but not sufficient: it says nothing about
// WHICH camera. A resident-privacy-scoped home camera's event text could
// previously reach the ambient awareness feed for any actor whose role
// alone passed can_view_camera, even though that same actor is correctly
// denied direct access to that exact camera by
// modules/cameras/cameraAccess.policy.ts's canAccessCamera. This reuses
// that SAME policy function rather than inventing a second interpretation
// of camera privacy -- see loadCameraAccessLookup below for how the
// lookup map is built.
function isCameraEventAuthorized(event: any, actor: AuthUser | null | undefined, cameraById: Map<string, any>) {
  const cameraId = String(event?.camera_id || event?.metadata?.camera_id || "").trim();
  const camera = cameraId ? cameraById.get(cameraId) : null;
  // A camera missing from the lookup (deleted, or the caller's batch
  // fetch failed/omitted it) is treated as inaccessible rather than
  // shown -- the same fail-closed posture canAccessCamera itself takes
  // for a home camera with no resolvable home scope.
  if (!camera) return false;
  return canAccessCamera(camera, cameraAccessActor(actor, null)).ok;
}

// Batch-resolves the facility_cameras rows referenced by any camera-category
// event in the given list, keyed by camera id, for use with
// filterEventsForActor's optional cameraById parameter (or
// filterCameraProtectedEvents below). Callers that never pass this map
// preserve the pre-Slice-1 role-only behavior for that call site.
export async function loadCameraAccessLookup(events: any[]): Promise<Map<string, any>> {
  const ids = Array.from(
    new Set(
      (events || [])
        .filter((event) => normalizeIntelligenceCategory(event?.category) === "camera")
        .map((event) => String(event?.camera_id || event?.metadata?.camera_id || "").trim())
        .filter(Boolean)
    )
  );
  const lookup = new Map<string, any>();
  if (!ids.length) return lookup;
  const { data, error } = await supabaseAdmin
    .from("facility_cameras")
    .select("id,estate_id,home_id,privacy_scope,metadata")
    .in("id", ids);
  if (error || !data) return lookup;
  for (const camera of data) lookup.set(String((camera as any).id), camera);
  return lookup;
}

// Standalone camera-privacy filter for call sites (e.g. executive.ts) that
// intentionally do not run their events through the rest of
// filterEventsForActor's role/category gating.
export function filterCameraProtectedEvents(events: any[], actor: AuthUser | null | undefined, cameraById: Map<string, any>) {
  return (events || []).filter((event) => {
    if (normalizeIntelligenceCategory(event?.category) !== "camera") return true;
    return isCameraEventAuthorized(event, actor, cameraById);
  });
}

export function filterEventsForActor(events: any[], actor?: AuthUser | null, cameraById?: Map<string, any> | null) {
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
    if (category === "camera") {
      if (!policy.can_view_camera) return false;
      if (cameraById && !isCameraEventAuthorized(event, actor, cameraById)) return false;
    }
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
