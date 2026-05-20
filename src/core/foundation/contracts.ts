export const CONTRACT_VERSION = "ochiga.tier1.2026-05-16";

export type PlatformIdentity = {
  id: string;
  email?: string;
  username?: string;
  full_name?: string;
  role: string;
  estate_id?: string | null;
  home_id?: string | null;
  permissions?: string[];
  permission_scopes?: string[];
};

export type EstateContract = {
  id: string;
  name: string;
  status: string;
  subscription_status?: string;
  package_id?: string | null;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  health_score?: number | null;
  buildings_count?: number;
  homes_count?: number;
  devices_count?: number;
  resident_count?: number;
  wallet_balance?: number;
  monthly_recurring_revenue?: number;
  support_open?: number;
  support_escalated?: number;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
};

export type HomeContract = {
  id: string;
  estate_id: string;
  building_id?: string | null;
  name: string;
  residents_count?: number;
  devices_count?: number;
  wallet_balance?: number;
  automation_state?: string;
  created_at?: string;
  updated_at?: string;
};

export type DeviceContract = {
  id: string;
  estate_id?: string | null;
  building_id?: string | null;
  home_id?: string | null;
  room_id?: string | null;
  name: string;
  category: string;
  provider?: string;
  protocol?: string;
  status: string;
  battery_level?: number | null;
  last_seen_at?: string | null;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
};

export type WalletContract = {
  id: string;
  scope_type: "estate" | "home" | "user";
  scope_id: string;
  label: string;
  balance: number;
  currency: string;
  pending_charges?: number;
  created_at?: string;
  updated_at?: string;
};

export type SupportTicketContract = {
  id: string;
  estate_id?: string | null;
  building_id?: string | null;
  home_id?: string | null;
  title: string;
  category: string;
  channel: string;
  priority: string;
  status: string;
  assigned_team?: string;
  created_at?: string;
  updated_at?: string;
};

export type AuditEventContract = {
  actorId?: string | null;
  actorRole?: string;
  actorEmail?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  estateId?: string | null;
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
  timestamp: string;
  status: "success" | "denied" | "failed" | "queued";
  homeId?: string | null;
};
