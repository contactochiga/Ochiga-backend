// src/services/NotificationService.ts

import { supabaseAdmin } from "../supabase/supabaseClient";
import { io } from "../server";
import { PushNotificationService } from "./PushNotificationService";

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
    return {
      user_id: userId,
      estate_id: estateId ?? (notification.payload as any)?.estate_id ?? null,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      payload: notification.payload || {},
      entity_id: notification.entityId || null,
    };
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
    const { data: rows, error } = await insertNotificationRows([
      this.normalizeRow(userId, notification),
    ]);
    const data = rows?.[0] || null;

    if (!error && data) {
      io.to(`user:${userId}`).emit("notification:new", data);
      await PushNotificationService.sendToUsers([userId], {
        title: notification.title,
        body: notification.message,
        sound: "default",
        badge: 1,
        data: this.buildPushData(data),
      });
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

    const insertData = users.map((u) => this.normalizeRow(String(u.id), notification));
    const { data, error: insertError } = await insertNotificationRows(insertData);

    (data || []).forEach((row: any) =>
      io.to(`user:${row.user_id}`).emit("notification:new", row)
    );

    for (const row of data || []) {
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

    const insertData = users.map((u) => this.normalizeRow(String(u.id), notification, estateId));
    const { data, error: insertError } = await insertNotificationRows(insertData);

    (data || []).forEach((row: any) =>
      io.to(`user:${row.user_id}`).emit("notification:new", row)
    );

    for (const row of data || []) {
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

    const insertData = users.map((u) => this.normalizeRow(String(u.id), notification));
    const { data, error: insertError } = await insertNotificationRows(insertData);

    (data || []).forEach((row: any) =>
      io.to(`user:${row.user_id}`).emit("notification:new", row)
    );

    for (const row of data || []) {
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

    const insertData = userIds.map((userId) => ({
      ...this.normalizeRow(userId, notification, estateId),
    }));

    const { data, error: insertError } = await insertNotificationRows(insertData);

    (data || []).forEach((row: any) =>
      io.to(`user:${row.user_id}`).emit("notification:new", row)
    );

    for (const row of data || []) {
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
