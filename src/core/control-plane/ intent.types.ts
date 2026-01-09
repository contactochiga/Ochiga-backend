// src/core/control-plane/intent.types.ts

export const INTENT_SCHEMA_VERSION = "v1";

export type IntentTarget =
  | "device"
  | "notification"
  | "system";

export interface BaseIntent {
  schemaVersion: typeof INTENT_SCHEMA_VERSION;

  target: IntentTarget;
  reason: string;
  priority: "low" | "normal" | "high" | "critical";

  // ---- control-plane metadata ----
  region_id?: string | null;
  estate_id?: string | null;
  zone_id?: string | null;
  source_signal?: string;
  created_at?: string;
}

export interface NotifyIntent extends BaseIntent {
  target: "notification";
  audience: "resident" | "manager" | "operator";
  scope: "user" | "home" | "estate" | "region";
  referenceId: string;
  payload: {
    title: string;
    message: string;
    type: string;
  };
}

export interface DeviceCommandIntent extends BaseIntent {
  target: "device";
  deviceId: string;
  command: unknown;
}

export type Intent =
  | NotifyIntent
  | DeviceCommandIntent;
