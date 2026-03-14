// src/types/user.ts

export type UserRole =
  // consumer + facility base
  | "resident"
  | "manager"
  | "operator"
  | "estate_admin"
  | "admin"
  | "system_admin"
  | "auditor"

  // ✅ facility / access control roles
  | "owner"
  | "security"
  | "staff"
  | "member"
  | "guest"
  | "viewer";
