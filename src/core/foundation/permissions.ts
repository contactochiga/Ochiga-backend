export const PERMISSION_KEYS = [
  "estates.read",
  "estates.write",
  "homes.read",
  "homes.write",
  "devices.read",
  "devices.control",
  "cameras.view",
  "visitors.create",
  "visitors.manage",
  "wallets.read",
  "wallets.manage",
  "services.read",
  "services.pay",
  "services.manage",
  "support.read",
  "support.assign",
  "documents.generate",
  "twin.view",
  "twin.control",
  "planstudio.read",
  "planstudio.write",
  "staff.manage",
  "settings.manage",
  "audit.read",
  "office.read",
  "office.manage",
  "community.read",
  "community.write",
  "community.moderate",
  "community.broadcast",
  "community.manage_announcements",
  "notifications.read",
  "notifications.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PLATFORM_ROLES = [
  "super_admin",
  "ochiga_admin",
  "ochiga_staff",
  "estate_admin",
  "facility_manager",
  "security_operator",
  "maintenance_operator",
  "finance_operator",
  "resident",
  "guest",
  "ai_agent",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export type AnyRole = PlatformRole | "admin" | "system_admin" | "manager" | "operator" | "owner" | "security" | "staff" | "member" | "viewer" | "auditor";

export const LEGACY_ROLE_ALIASES: Record<string, PlatformRole> = {
  admin: "super_admin",
  system_admin: "super_admin",
  auditor: "ochiga_staff",
  manager: "facility_manager",
  operator: "maintenance_operator",
  owner: "estate_admin",
  security: "security_operator",
  staff: "ochiga_staff",
  member: "resident",
  viewer: "guest",
};

export const ROLE_PERMISSIONS: Record<PlatformRole, readonly PermissionKey[]> = {
  super_admin: PERMISSION_KEYS,
  ochiga_admin: PERMISSION_KEYS,
  ochiga_staff: [
    "office.read",
    "estates.read",
    "homes.read",
    "devices.read",
    "cameras.view",
    "support.read",
    "support.assign",
    "documents.generate",
    "community.read",
    "community.moderate",
    "notifications.read",
    "notifications.manage",
  ],
  estate_admin: [
    "estates.read",
    "estates.write",
    "homes.read",
    "homes.write",
    "devices.read",
    "devices.control",
    "cameras.view",
    "visitors.create",
    "visitors.manage",
    "wallets.read",
    "wallets.manage",
    "services.read",
    "services.pay",
    "services.manage",
    "support.read",
    "support.assign",
    "staff.manage",
    "community.read",
    "community.write",
    "community.moderate",
    "community.broadcast",
    "community.manage_announcements",
    "notifications.read",
  ],
  facility_manager: [
    "estates.read",
    "estates.write",
    "homes.read",
    "homes.write",
    "devices.read",
    "devices.control",
    "cameras.view",
    "visitors.manage",
    "wallets.read",
    "services.read",
    "services.pay",
    "services.manage",
    "support.read",
    "support.assign",
    "staff.manage",
    "community.read",
    "community.write",
    "community.moderate",
    "community.broadcast",
    "community.manage_announcements",
    "notifications.read",
  ],
  security_operator: [
    "estates.read",
    "homes.read",
    "devices.read",
    "devices.control",
    "cameras.view",
    "visitors.create",
    "visitors.manage",
    "support.read",
    "notifications.read",
  ],
  maintenance_operator: [
    "estates.read",
    "homes.read",
    "devices.read",
    "devices.control",
    "support.read",
    "support.assign",
    "notifications.read",
  ],
  finance_operator: [
    "estates.read",
    "homes.read",
    "wallets.read",
    "wallets.manage",
    "services.read",
    "services.pay",
    "services.manage",
    "documents.generate",
    "support.read",
    "notifications.read",
  ],
  resident: [
    "estates.read",
    "homes.read",
    "devices.read",
    "devices.control",
    "visitors.create",
    "wallets.read",
    "services.read",
    "services.pay",
    "support.read",
    "community.read",
    "community.write",
    "notifications.read",
  ],
  guest: ["visitors.create"],
  ai_agent: [
    "office.read",
    "estates.read",
    "homes.read",
    "devices.read",
    "cameras.view",
    "support.read",
    "services.read",
    "community.read",
    "twin.view",
    "planstudio.read",
  ],
};

export function canonicalRole(role?: string | null): PlatformRole {
  const raw = String(role || "guest").trim().toLowerCase();
  if (LEGACY_ROLE_ALIASES[raw]) return LEGACY_ROLE_ALIASES[raw];
  if ((PLATFORM_ROLES as readonly string[]).includes(raw)) return raw as PlatformRole;
  return "guest";
}

export function permissionsForRole(role?: string | null, extraScopes: string[] = []) {
  const canonical = canonicalRole(role);
  return Array.from(new Set([...(ROLE_PERMISSIONS[canonical] || []), ...extraScopes])) as PermissionKey[];
}

export function hasPermission(user: { role?: string | null; permission_scopes?: string[]; permissions?: string[] } | null | undefined, permission: PermissionKey | string) {
  if (!user) return false;
  const scopes = [...(user.permission_scopes || []), ...(user.permissions || [])];
  return permissionsForRole(user.role, scopes).includes(permission as PermissionKey) || scopes.includes(permission);
}
