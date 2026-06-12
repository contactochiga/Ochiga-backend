import { supabaseAdmin } from "../supabase/supabaseClient";
import type { AuthUser } from "../middleware/auth";
import { getIntelligencePermissionPolicy } from "./permissionEngine";

export type OrganizationalSummaryType = "executive" | "management" | "marketing" | "sales" | "operations" | "support" | "deployment";

function canViewOrganization(actor?: AuthUser | null) {
  const role = getIntelligencePermissionPolicy(actor).role;
  return ["super_admin", "ochiga_admin", "estate_admin", "facility_manager"].includes(role);
}

async function safeList(table: string, select = "*", limit = 200) {
  const { data, error } = await supabaseAdmin.from(table).select(select).limit(limit);
  if (error) return { rows: [], warning: error.message };
  return { rows: data || [] };
}

async function safeCount(table: string) {
  const { count, error } = await supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  if (error) return { count: 0, warning: error.message };
  return { count: count || 0 };
}

export async function getOrganizationDirectory(actor?: AuthUser | null) {
  if (!canViewOrganization(actor)) return { ok: false, error: "Organization intelligence requires management access" };
  const [departments, teams, roles, employees, responsibilities, assignments] = await Promise.all([
    safeList("ochiga_organization_departments"),
    safeList("ochiga_organization_teams"),
    safeList("ochiga_organization_roles"),
    safeList("ochiga_organization_employees", "id,user_id,department_id,team_id,role_id,display_name,email,status,metadata,created_at,updated_at"),
    safeList("ochiga_organization_responsibilities"),
    safeList("ochiga_organization_assignments"),
  ]);
  return {
    ok: true,
    departments: departments.rows,
    teams: teams.rows,
    roles: roles.rows,
    employees: employees.rows,
    responsibilities: responsibilities.rows,
    assignments: assignments.rows,
    warnings: [departments.warning, teams.warning, roles.warning, employees.warning, responsibilities.warning, assignments.warning].filter(Boolean),
  };
}

export async function getOrganizationSummary(actor?: AuthUser | null) {
  if (!canViewOrganization(actor)) return { ok: false, error: "Organization intelligence requires management access" };
  const [departments, teams, roles, employees, responsibilities, assignments, collaborations] = await Promise.all([
    safeCount("ochiga_organization_departments"),
    safeCount("ochiga_organization_teams"),
    safeCount("ochiga_organization_roles"),
    safeCount("ochiga_organization_employees"),
    safeCount("ochiga_organization_responsibilities"),
    safeCount("ochiga_organization_assignments"),
    safeCount("ochiga_agent_collaborations"),
  ]);
  return {
    ok: true,
    scopes: ["employee", "team", "department", "company"],
    counts: {
      departments: departments.count,
      teams: teams.count,
      roles: roles.count,
      employees: employees.count,
      responsibilities: responsibilities.count,
      assignments: assignments.count,
      collaborations: collaborations.count,
    },
    memory_boundary: "Organizational memory is separate from resident, home, estate, and lead memory. Executive summaries consume summarized intelligence only.",
    warnings: [departments.warning, teams.warning, roles.warning, employees.warning, responsibilities.warning, assignments.warning, collaborations.warning].filter(Boolean),
  };
}

export async function listDepartments(actor?: AuthUser | null) {
  if (!canViewOrganization(actor)) return { ok: false, error: "Organization intelligence requires management access", departments: [] };
  const result = await safeList("ochiga_organization_departments");
  return { ok: true, departments: result.rows, warning: result.warning || null };
}

export async function listTeams(actor?: AuthUser | null) {
  if (!canViewOrganization(actor)) return { ok: false, error: "Organization intelligence requires management access", teams: [] };
  const result = await safeList("ochiga_organization_teams");
  return { ok: true, teams: result.rows, warning: result.warning || null };
}
