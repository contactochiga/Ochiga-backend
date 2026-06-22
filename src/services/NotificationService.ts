// src/services/NotificationService.ts

import { supabaseAdmin } from "../supabase/supabaseClient";
import { io } from "../server";
import { PushNotificationService } from "./PushNotificationService";
import { decideNotification, recordNotificationDecision } from "./notificationPolicyService";
import { publishSourceIntelligenceEvent } from "../intelligence-core";
import { normalizeNotificationRouting, routingColumns, withNotificationRouting } from "./notifications/notificationRoutingService";
import type { OisNotificationRouting } from "../types/notificationRouting";

/**
 * Types of notifications
 * Must stay in sync with control-plane contracts
 */
export type NotificationType =
  | "visitor"
  | "maintenance"
  | "device"
  | "room"
  | "home"
  | "estate"
  | "community"
  | "wallet"
  | "system";

/**
 * Notification payload contract
 * Used by IntentWorker + Control Plane
 */
export interface NotificationPayload {
  title: string;
  message: string;
  type: NotificationType;
  payload?: Record<string, any>; // optional structured data
  entityId?: string;             // optional related entity
  routing?: Partial<OisNotificationRouting>;
}

function publishNotificationEvent(row: any) {
  if (!row?.id) return;
  void publishSourceIntelligenceEvent({
    source: "consumer",
    surface: "consumer",
    event_type: `notification.${String(row.type || "created").toLowerCase()}`,
    category: String(row.type || "system"),
    estate_id: row.estate_id || row.payload?.estate_id || null,
    home_id: row.home_id || row.payload?.home_id || null,
    actor_id: row.user_id || null,
    entity_type: "notification",
    entity_id: row.id,
    entity_label: row.title || "Notification",
    severity: /security|critical|emergency/i.test(`${row.type || ""} ${row.title || ""}`) ? "critical" : "info",
    title: row.title || "Notification",
    summary: row.message || row.title || "Notification created.",
    payload: { ...(row.payload || {}), routing: withNotificationRouting(row).routing },
    occurred_at: row.created_at,
  }, { source_table: "notifications", source_event_id: String(row.id) });
}

function extractMissingColumnName(msg: string): string | null {
  if (!msg) return null;
  let m = msg.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (m?.[1]) return m[1];
  m = msg.match(/column\s+"([^"]+)"\s+of\s+relation/i);
  if (m?.[1]) return m[1];
  m = msg.match(/(?:unknown|missing)\s+column[:\s]+([a-zA-Z0-9_]+)/i);
  if (m?.[1]) return m[1];
  return null;
}

function compact<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

async function insertNotificationRows(rows: Record<string, any>[]) {
  if (!rows.length) return { data: [], error: null };
  let payload = rows.map((row) => ({ ...compact(row) }));
  let lastErrorMsg = "";

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .insert(payload)
      .select();

    if (!error) return { data: data || [], error: null };

    const msg = String((error as any)?.message || "");
    lastErrorMsg = msg;
    const missingCol = extractMissingColumnName(msg);

    if (missingCol) {
      payload = payload.map((row) => {
        const next = { ...row };
        delete (next as any)[missingCol];
        return next;
      });
      continue;
    }

    console.error("[notifications] insert failed", {
      error: msg || "unknown",
      sample: payload[0] || null,
    });
    return { data: [], error };
  }

  console.error("[notifications] insert failed after schema fallback", {
    error: lastErrorMsg || "unknown",
    sample: payload[0] || null,
  });
  return { data: [], error: { message: lastErrorMsg || "Insert failed" } as any };
}

/**
 * Notification Service
 * Execution-plane boundary (side effects live here)
 */
export class NotificationService {
  private static normalizeRow(userId: string, notification: NotificationPayload, estateId?: string | null) {
    const base = {
      user_id: userId,
      estate_id: estateId ?? (notification.payload as any)?.estate_id ?? null,
      home_id: (notification.payload as any)?.home_id ?? null,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      payload: notification.payload || {},
      entity_id: notification.entityId || null,
      delivery_channel: (notification.payload as any)?.delivery_channel,
      notification_key: (notification.payload as any)?.notification_key,
    };
    return { ...base, ...routingColumns(normalizeNotificationRouting({ ...base, routing: notification.routing })) };
  }

  private static buildPushData(row: any) {
    return {
      id: String(row?.id || ""),
      title: String(row?.title || ""),
      message: String(row?.message || ""),
      type: String(row?.type || "system"),
      status: String(row?.status || "unread"),
      entityId: row?.entityId || row?.entity_id || null,
      created_at: row?.created_at || new Date().toISOString(),
      payload: row?.payload || {},
      routing: withNotificationRouting(row).routing,
      estate_id: row?.estate_id || null,
    };
  }

  private static async getEstateUserIdsByRole(estateId: string, role: string) {
    const normalizedRole = String(role || "").trim().toLowerCase();
    const byMembership = await supabaseAdmin
      .from("estate_memberships")
      .select("user_id")
      .eq("estate_id", estateId)
      .eq("status", "active")
      .eq("role", normalizedRole);

    if (!byMembership.error && (byMembership.data || []).length) {
      return Array.from(
        new Set(
          (byMembership.data || [])
            .map((r: any) => String(r?.user_id || "").trim())
            .filter(Boolean)
        )
      );
    }

    const byUserRole = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("estate_id", estateId)
      .eq("role", normalizedRole);

    if (byUserRole.error) return [];
    return Array.from(
      new Set(
        (byUserRole.data || [])
          .map((r: any) => String(r?.id || "").trim())
          .filter(Boolean)
      )
    );
  }

  /** Send notification to a single user */
  static async sendToUser(userId: string, notification: NotificationPayload) {
    const policy = await decideNotification(userId, notification).catch(() => null);
    const nextPayload = {
      ...(notification.payload || {}),
      notification_key: policy?.key || (notification.payload as any)?.notification_key,
      delivery_channel: policy?.decision || "push",
      notification_category: policy?.category || null,
      notification_reason: policy?.reason || null,
    };
    if (policy) {
      await recordNotificationDecision({
        userId,
        estateId: (nextPayload as any).estate_id || null,
        homeId: (nextPayload as any).home_id || null,
        key: policy.key,
        category: policy.category,
        decision: policy.decision,
        title: notification.title,
        reason: policy.reason,
      });
    }
    if (policy?.decision === "activity_only" || policy?.decision === "suppressed") {
      return { data: null, error: null, skipped: true, decision: policy.decision };
    }
    const decorated = { ...notification, payload: nextPayload };
    const { data: rows, error } = await insertNotificationRows([
      this.normalizeRow(userId, decorated),
    ]);
    const data = rows?.[0] || null;

    if (!error && data) {
      publishNotificationEvent(data);
      io.to(`user:${userId}`).emit("notification:new", data);
      if (!policy || policy.decision === "push" || policy.decision === "critical_push") {
        await PushNotificationService.sendToUsers([userId], {
          title: notification.title,
          body: notification.message,
          sound: "default",
          badge: 1,
          data: this.buildPushData(data),
        });
      }
    }

    return { data, error };
  }

  /** Send notification to all users in a home */
  static async sendToHome(homeId: string, notification: NotificationPayload) {
    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("home_id", homeId);

    if (error || !users?.length) return { error };

    const prepared: any[] = [];
    const pushRows = new Set<string>();
    for (const u of users) {
      const userId = String(u.id);
      const policy = await decideNotification(userId, notification).catch(() => null);
      const nextPayload = {
        ...(notification.payload || {}),
        notification_key: policy?.key || (notification.payload as any)?.notification_key,
        delivery_channel: policy?.decision || "push",
        notification_category: policy?.category || null,
        notification_reason: policy?.reason || null,
      };
      if (policy) {
        await recordNotificationDecision({ userId, estateId: (nextPayload as any).estate_id || null, homeId: (nextPayload as any).home_id || homeId || null, key: policy.key, category: policy.category, decision: policy.decision, title: notification.title, reason: policy.reason });
        if (policy.decision === "activity_only" || policy.decision === "suppressed") continue;
        if (policy.decision === "push" || policy.decision === "critical_push") pushRows.add(userId);
      } else {
        pushRows.add(userId);
      }
      prepared.push(this.normalizeRow(userId, { ...notification, payload: nextPayload }));
    }
    const { data, error: insertError } = await insertNotificationRows(prepared);

    (data || []).forEach((row: any) => {
      publishNotificationEvent(row);
      io.to(`user:${row.user_id}`).emit("notification:new", row);
    });

    for (const row of data || []) {
      if (!pushRows.has(String((row as any).user_id))) continue;
      await PushNotificationService.sendToUsers([String((row as any).user_id)], {
        title: String((row as any).title || notification.title),
        body: String((row as any).message || notification.message),
        sound: "default",
        badge: 1,
        data: this.buildPushData(row),
      });
    }

    return { data, error: insertError };
  }

  /** Send notification to all users in an estate */
  static async sendToEstate(estateId: string, notification: NotificationPayload) {
    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("estate_id", estateId);

    if (error || !users?.length) return { error };

    const prepared: any[] = [];
    const pushRows = new Set<string>();
    for (const u of users) {
      const userId = String(u.id);
      const policy = await decideNotification(userId, notification).catch(() => null);
      const nextPayload = {
        ...(notification.payload || {}),
        estate_id: (notification.payload as any)?.estate_id || estateId,
        notification_key: policy?.key || (notification.payload as any)?.notification_key,
        delivery_channel: policy?.decision || "push",
        notification_category: policy?.category || null,
        notification_reason: policy?.reason || null,
      };
      if (policy) {
        await recordNotificationDecision({ userId, estateId, homeId: (nextPayload as any).home_id || null, key: policy.key, category: policy.category, decision: policy.decision, title: notification.title, reason: policy.reason });
        if (policy.decision === "activity_only" || policy.decision === "suppressed") continue;
        if (policy.decision === "push" || policy.decision === "critical_push") pushRows.add(userId);
      } else {
        pushRows.add(userId);
      }
      prepared.push(this.normalizeRow(userId, { ...notification, payload: nextPayload }, estateId));
    }
    const { data, error: insertError } = await insertNotificationRows(prepared);

    (data || []).forEach((row: any) => {
      publishNotificationEvent(row);
      io.to(`user:${row.user_id}`).emit("notification:new", row);
    });

    for (const row of data || []) {
      if (!pushRows.has(String((row as any).user_id))) continue;
      await PushNotificationService.sendToUsers([String((row as any).user_id)], {
        title: String((row as any).title || notification.title),
        body: String((row as any).message || notification.message),
        sound: "default",
        badge: 1,
        data: this.buildPushData(row),
      });
    }

    return { data, error: insertError };
  }

  /** Send notification to all users in a region */
  static async sendToRegion(regionId: string, notification: NotificationPayload) {
    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("region_id", regionId);

    if (error || !users?.length) return { error };

    const prepared: any[] = [];
    const pushRows = new Set<string>();
    for (const u of users) {
      const userId = String(u.id);
      const policy = await decideNotification(userId, notification).catch(() => null);
      const nextPayload = {
        ...(notification.payload || {}),
        notification_key: policy?.key || (notification.payload as any)?.notification_key,
        delivery_channel: policy?.decision || "push",
        notification_category: policy?.category || null,
        notification_reason: policy?.reason || null,
      };
      if (policy) {
        await recordNotificationDecision({ userId, estateId: (nextPayload as any).estate_id || null, homeId: (nextPayload as any).home_id || null, key: policy.key, category: policy.category, decision: policy.decision, title: notification.title, reason: policy.reason });
        if (policy.decision === "activity_only" || policy.decision === "suppressed") continue;
        if (policy.decision === "push" || policy.decision === "critical_push") pushRows.add(userId);
      } else {
        pushRows.add(userId);
      }
      prepared.push(this.normalizeRow(userId, { ...notification, payload: nextPayload }));
    }
    const { data, error: insertError } = await insertNotificationRows(prepared);

    (data || []).forEach((row: any) => {
      publishNotificationEvent(row);
      io.to(`user:${row.user_id}`).emit("notification:new", row);
    });

    for (const row of data || []) {
      if (!pushRows.has(String((row as any).user_id))) continue;
      await PushNotificationService.sendToUsers([String((row as any).user_id)], {
        title: String((row as any).title || notification.title),
        body: String((row as any).message || notification.message),
        sound: "default",
        badge: 1,
        data: this.buildPushData(row),
      });
    }

    return { data, error: insertError };
  }

  /** Send notification to specific role in an estate (guards, admins, etc.) */
  static async sendToRole(
    estateId: string,
    role: string,
    notification: NotificationPayload
  ) {
    const userIds = await this.getEstateUserIdsByRole(estateId, role);
    if (!userIds.length) return { error: null };

    const prepared: any[] = [];
    const pushRows = new Set<string>();
    for (const userId of userIds) {
      const policy = await decideNotification(userId, notification).catch(() => null);
      const nextPayload = {
        ...(notification.payload || {}),
        estate_id: (notification.payload as any)?.estate_id || estateId,
        notification_key: policy?.key || (notification.payload as any)?.notification_key,
        delivery_channel: policy?.decision || "push",
        notification_category: policy?.category || null,
        notification_reason: policy?.reason || null,
      };
      if (policy) {
        await recordNotificationDecision({ userId, estateId, homeId: (nextPayload as any).home_id || null, key: policy.key, category: policy.category, decision: policy.decision, title: notification.title, reason: policy.reason });
        if (policy.decision === "activity_only" || policy.decision === "suppressed") continue;
        if (policy.decision === "push" || policy.decision === "critical_push") pushRows.add(userId);
      } else {
        pushRows.add(userId);
      }
      prepared.push({ ...this.normalizeRow(userId, { ...notification, payload: nextPayload }, estateId) });
    }

    const { data, error: insertError } = await insertNotificationRows(prepared);

    (data || []).forEach((row: any) => {
      publishNotificationEvent(row);
      io.to(`user:${row.user_id}`).emit("notification:new", row);
    });

    for (const row of data || []) {
      if (!pushRows.has(String((row as any).user_id))) continue;
      await PushNotificationService.sendToUsers([String((row as any).user_id)], {
        title: String((row as any).title || notification.title),
        body: String((row as any).message || notification.message),
        sound: "default",
        badge: 1,
        data: this.buildPushData(row),
      });
    }

    return { data, error: insertError };
  }

  /** Mark a notification as read */
  static async markAsRead(notificationId: string) {
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .update({
        status: "read",
        updated_at: new Date().toISOString(),
      })
      .eq("id", notificationId)
      .select()
      .single();

    return { data, error };
  }
}

/**
 * Helper shortcut (optional)
 */
export const notifyUser = async (
  userId: string,
  payload: NotificationPayload
) => {
  return NotificationService.sendToUser(userId, payload);
};
