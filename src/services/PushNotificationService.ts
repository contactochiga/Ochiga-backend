import axios from "axios";
import { supabaseAdmin } from "../supabase/supabaseClient";

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, any>;
};

const FCM_SERVER_KEY = String(process.env.FCM_SERVER_KEY || "").trim();
const FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send";

function canSendPush() {
  return !!FCM_SERVER_KEY;
}

export class PushNotificationService {
  static async registerToken(params: {
    userId: string;
    token: string;
    platform?: string | null;
    deviceId?: string | null;
    appVersion?: string | null;
  }) {
    const token = String(params.token || "").trim();
    if (!token) return { error: "Push token is required" };

    const payload = {
      user_id: params.userId,
      token,
      platform: params.platform ? String(params.platform) : null,
      device_id: params.deviceId ? String(params.deviceId) : null,
      app_version: params.appVersion ? String(params.appVersion) : null,
      active: true,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("user_push_tokens")
      .upsert(payload, { onConflict: "token" })
      .select("*")
      .maybeSingle();

    return { data, error };
  }

  static async removeToken(token: string) {
    const clean = String(token || "").trim();
    if (!clean) return { error: "Push token is required" };

    const { data, error } = await supabaseAdmin
      .from("user_push_tokens")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("token", clean)
      .select("*");

    return { data, error };
  }

  static async sendToUsers(userIds: string[], payload: PushPayload) {
    if (!canSendPush()) return { ok: false, skipped: true, reason: "FCM_SERVER_KEY missing" };
    if (!Array.isArray(userIds) || userIds.length === 0) return { ok: true, sent: 0 };

    const uniqueUserIds = Array.from(new Set(userIds.map((x) => String(x || "").trim()).filter(Boolean)));
    if (!uniqueUserIds.length) return { ok: true, sent: 0 };

    const { data: rows, error } = await supabaseAdmin
      .from("user_push_tokens")
      .select("token,user_id")
      .in("user_id", uniqueUserIds)
      .eq("active", true);

    if (error) return { ok: false, error };
    const tokens = Array.from(
      new Set((rows || []).map((r: any) => String(r?.token || "").trim()).filter(Boolean))
    );
    if (!tokens.length) return { ok: true, sent: 0 };

    let sent = 0;
    for (const token of tokens) {
      try {
        await axios.post(
          FCM_ENDPOINT,
          {
            to: token,
            priority: "high",
            notification: {
              title: payload.title,
              body: payload.body,
              sound: "default",
            },
            data: payload.data || {},
          },
          {
            headers: {
              Authorization: `key=${FCM_SERVER_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          }
        );
        sent += 1;
      } catch {
        // fail-soft per token
      }
    }

    return { ok: true, sent };
  }
}

