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

/**
 * Notification Service
 * Execution-plane boundary (side effects live here)
 */
export class NotificationService {
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
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .insert([{ user_id: userId, estate_id: (notification.payload as any)?.estate_id || null, ...notification }])
      .select()
      .single();

    if (!error && data) {
      io.to(`user:${userId}`).emit("notification:new", data);
      await PushNotificationService.sendToUsers([userId], {
        title: notification.title,
        body: notification.message,
        data: {
          type: notification.type,
          entityId: notification.entityId || null,
          ...(notification.payload || {}),
        },
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

    const insertData = users.map((u) => ({
      user_id: u.id,
      estate_id: (notification.payload as any)?.estate_id || null,
      ...notification,
    }));

    const { data, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(insertData)
      .select();

    users.forEach((u) =>
      io.to(`user:${u.id}`).emit("notification:new", notification)
    );

    await PushNotificationService.sendToUsers(
      users.map((u: any) => String(u.id)),
      {
        title: notification.title,
        body: notification.message,
        data: {
          type: notification.type,
          entityId: notification.entityId || null,
          ...(notification.payload || {}),
        },
      }
    );

    return { data, error: insertError };
  }

  /** Send notification to all users in an estate */
  static async sendToEstate(estateId: string, notification: NotificationPayload) {
    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("estate_id", estateId);

    if (error || !users?.length) return { error };

    const insertData = users.map((u) => ({
      user_id: u.id,
      estate_id: estateId,
      ...notification,
    }));

    const { data, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(insertData)
      .select();

    users.forEach((u) =>
      io.to(`user:${u.id}`).emit("notification:new", notification)
    );

    await PushNotificationService.sendToUsers(
      users.map((u: any) => String(u.id)),
      {
        title: notification.title,
        body: notification.message,
        data: {
          type: notification.type,
          entityId: notification.entityId || null,
          ...(notification.payload || {}),
        },
      }
    );

    return { data, error: insertError };
  }

  /** Send notification to all users in a region */
  static async sendToRegion(regionId: string, notification: NotificationPayload) {
    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("region_id", regionId);

    if (error || !users?.length) return { error };

    const insertData = users.map((u) => ({
      user_id: u.id,
      estate_id: (notification.payload as any)?.estate_id || null,
      ...notification,
    }));

    const { data, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(insertData)
      .select();

    users.forEach((u) =>
      io.to(`user:${u.id}`).emit("notification:new", notification)
    );

    await PushNotificationService.sendToUsers(
      users.map((u: any) => String(u.id)),
      {
        title: notification.title,
        body: notification.message,
        data: {
          type: notification.type,
          entityId: notification.entityId || null,
          ...(notification.payload || {}),
        },
      }
    );

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
      user_id: userId,
      estate_id: estateId,
      ...notification,
    }));

    const { data, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(insertData)
      .select();

    userIds.forEach((userId) =>
      io.to(`user:${userId}`).emit("notification:new", notification)
    );

    await PushNotificationService.sendToUsers(
      userIds,
      {
        title: notification.title,
        body: notification.message,
        data: {
          type: notification.type,
          entityId: notification.entityId || null,
          ...(notification.payload || {}),
        },
      }
    );

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
