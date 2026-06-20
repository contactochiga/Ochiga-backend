import { INTENT_SCHEMA_VERSION } from "./versions";
import { NotificationType } from "../../../services/NotificationService";

export type IntentTarget = "device" | "notification" | "system" | "intelligence";

export interface IntentContext {
  region_id?: string | null;
  estate_id?: string | null;
  zone_id?: string | null;
  source_signal: string;
  created_at: string;
}

export interface BaseIntent {
  schemaVersion: typeof INTENT_SCHEMA_VERSION;
  target: IntentTarget;
  reason: string;
  priority: "low" | "normal" | "high" | "critical";
  context: IntentContext;
}

/**
 * Notification Intent
 * MUST align with NotificationService
 */
export interface NotifyIntent extends BaseIntent {
  target: "notification";
  audience: "resident" | "manager" | "operator";
  scope: "user" | "home" | "estate" | "region";
  referenceId: string;
  payload: {
    title: string;
    message: string;
    type: NotificationType; // ✅ FIXED
    payload?: Record<string, any>;
    entityId?: string;
  };
}

/**
 * Device Command Intent
 */
export interface DeviceCommandIntent extends BaseIntent {
  target: "device";
  deviceId: string;
  command: Record<string, any>;
}

export interface UniversalIntent extends BaseIntent {
  target: "intelligence";
  surface: "consumer" | "facility" | "office" | "oma" | "osa" | "watch" | "edge";
  intent: "awareness" | "investigation" | "workflow" | "execution" | "approval" | "assignment" | "notification" | "report" | "analytics" | "prediction";
  domain: string;
  action: string;
  entity_id?: string | null;
  workflow_id?: string | null;
  payload?: Record<string, unknown>;
}

export type Intent = NotifyIntent | DeviceCommandIntent | UniversalIntent;
