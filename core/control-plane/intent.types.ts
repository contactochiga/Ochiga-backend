// src/core/control-plane/intent.types.ts

export type IntentTarget =
  | "device"
  | "notification"
  | "system";

export interface BaseIntent {
  target: IntentTarget;
  reason: string;
  priority: "low" | "normal" | "high" | "critical";
}

export interface NotifyIntent extends BaseIntent {
  target: "notification";
  audience:
    | "resident"
    | "manager"
    | "operator";
  scope:
    | "user"
    | "home"
    | "estate"
    | "region";
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
  command: any;
}

export type Intent =
  | NotifyIntent
  | DeviceCommandIntent;
