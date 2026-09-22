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
 *
 * Wave 5D -- additive authority context. Before this, a DeviceCommandIntent
 * carried only deviceId/command -- no actor identity survived the queue
 * boundary at all, which is exactly why intentWorker.ts's handleDeviceIntent
 * had to bypass canonical DeviceCommandAuthority/executeDeviceCommandForActor
 * entirely and dispatch straight to the Tuya adapter. `actor` is optional
 * specifically so that already-queued pre-Wave-5D jobs (lacking this field)
 * remain valid Intent values at the type level -- the worker fails them
 * closed at runtime rather than the type system silently coercing them.
 * Never fabricated: deviceCommandPolicy only ever populates this from the
 * real DeviceCommandRequestedSignal.requestedBy (userId/role) the
 * authenticated caller of POST /signals actually supplied (or derived from
 * their own req.user), plus the same estate/home/room scope fields already
 * enriched onto that signal -- see signal.controller.ts's ingestSignal.
 */
export interface DeviceCommandIntent extends BaseIntent {
  target: "device";
  deviceId: string;
  command: Record<string, any>;
  actor?: {
    id: string;
    role: string;
    estateId?: string | null;
    homeId?: string | null;
    roomId?: string | null;
  };
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
