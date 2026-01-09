export const USER_ROLES = [
  "resident",
  "manager",
  "operator",
  "estate_admin",
  "system_admin",
] as const;

export type UserRole = typeof USER_ROLES[number];
