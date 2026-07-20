import type { UserRole } from "./user";

export type OisSurface = "consumer" | "facility" | "office" | "command_center" | "watch" | "edge";

export type OyiTargetType =
  | "workflow" | "prediction" | "incident" | "maintenance" | "visitor"
  | "device" | "camera" | "infrastructure" | "wallet" | "service"
  | "community" | "message" | "handover" | "none";

export type OyiTarget = {
  target_type: OyiTargetType;
  target_id?: string | null;
  infrastructure_source?: "devices" | "cameras" | "edge" | "utilities" | "providers";
  open_as: "drawer" | "page" | "queue" | "attention" | "none";
  action?: "inspect" | "approve" | "assign" | "acknowledge" | "verify" | "resolve" | "escalate" | "control" | "pay" | "message";
};

export type OisContextEstate = { id: string; name: string | null; role?: string | null };
export type OisContextHome = {
  id: string;
  membership_id?: string | null;
  name: string | null;
  block?: string | null;
  unit?: string | null;
  estate_id: string;
  electricity_meter?: string | null;
  water_meter?: string | null;
  internet_id?: string | null;
  gate_code?: string | null;
};

/**
 * The resolved operating scope. Client-provided IDs are hints only; this is the
 * object downstream services may trust after membership validation.
 */
export type OisContext = {
  actor_id: string;
  surface: OisSurface;
  role: UserRole | string;
  permissions: string[];
  organization_id: string | null;
  portfolio_id: string | null;
  account_id: string | null;
  deployment_id: string | null;
  estate_id: string | null;
  home_id: string | null;
  membership_id?: string | null;
  module: string | null;
  target: OyiTarget | null;
  estate: OisContextEstate | null;
  home: OisContextHome | null;
  available_estates: OisContextEstate[];
  available_homes: OisContextHome[];
  resolved_at: string;
};
