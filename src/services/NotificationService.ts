// src/services/NotificationService.ts

import { supabaseAdmin } from "../supabase/supabaseClient";
import { io } from "../server";

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
  /** Send notification to a single user */
  static async sendToUser(userId: string, notification: NotificationPayload) {
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .insert([{ user_id: userId, ...notification }])
      .select()
      .single();

    if (!error && data) {
      io.to(`user:${userId}`).emit("notification:new", data);
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
      ...notification,
    }));

    const { data, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(insertData)
      .select();

    users.forEach((u) =>
      io.to(`user:${u.id}`).emit("notification:new", notification)
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
      ...notification,
    }));

    const { data, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(insertData)
      .select();

    users.forEach((u) =>
      io.to(`user:${u.id}`).emit("notification:new", notification)
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
      ...notification,
    }));

    const { data, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(insertData)
      .select();

    users.forEach((u) =>
      io.to(`user:${u.id}`).emit("notification:new", notification)
    );

    return { data, error: insertError };
  }

  /** Send notification to specific role in an estate (guards, admins, etc.) */
  static async sendToRole(
    estateId: string,
    role: string,
    notification: NotificationPayload
  ) {
    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("estate_id", estateId)
      .eq("role", role);

    if (error || !users?.length) return { error };

    const insertData = users.map((u) => ({
      user_id: u.id,
      ...notification,
    }));

    const { data, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(insertData)
      .select();

    users.forEach((u) =>
      io.to(`user:${u.id}`).emit("notification:new", notification)
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
