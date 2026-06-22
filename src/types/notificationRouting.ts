import type { OyiTarget } from "./oisContext";

export type NotificationSourceType =
  | "visitor" | "maintenance" | "incident" | "workflow" | "prediction"
  | "device" | "camera" | "edge" | "utility" | "provider" | "wallet"
  | "service" | "community" | "message" | "handover" | "system";

export type NotificationDestination = "page" | "drawer" | "queue" | "attention" | "external" | "none";
export type NotificationActionability = "informational" | "review" | "approve" | "assign" | "acknowledge" | "resolve" | "verify" | "escalate";

export type OisNotificationRouting = {
  source_type: NotificationSourceType;
  source_id: string | null;
  destination: NotificationDestination;
  target: OyiTarget | null;
  actionability: NotificationActionability;
  attention_eligible: boolean;
  queue_eligible: boolean;
  acknowledgement_required: boolean;
};
