import axios from "axios";
import http2 from "http2";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabase/supabaseClient";

type PushPayload = {
  title: string;
  body: string;
  sound?: string;
  badge?: number;
  data?: Record<string, any>;
};

type PushTokenRow = {
  token: string;
  user_id: string;
  platform?: string | null;
};

const FCM_SERVER_KEY = String(process.env.FCM_SERVER_KEY || "").trim();
const FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send";

const APNS_KEY_ID = String(process.env.APNS_KEY_ID || "").trim();
const APNS_TEAM_ID = String(process.env.APNS_TEAM_ID || "").trim();
const APNS_BUNDLE_ID = String(process.env.APNS_BUNDLE_ID || "").trim();
const APNS_PRIVATE_KEY_RAW = String(
  process.env.APNS_PRIVATE_KEY || process.env.APNS_PRIVATE_KEY_BASE64 || ""
).trim();
const APNS_PRODUCTION = String(process.env.APNS_PRODUCTION || "true").toLowerCase() !== "false";

function canSendFcm() {
  return !!FCM_SERVER_KEY;
}

function normalizePlatform(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function decodeApnsPrivateKey() {
  if (!APNS_PRIVATE_KEY_RAW) return "";
  const raw = APNS_PRIVATE_KEY_RAW.replace(/\\n/g, "\n");
  if (raw.includes("BEGIN PRIVATE KEY")) return raw;

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (decoded.includes("BEGIN PRIVATE KEY")) return decoded;
  } catch {}

  return raw;
}

function canSendApns() {
  return !!(APNS_KEY_ID && APNS_TEAM_ID && APNS_BUNDLE_ID && decodeApnsPrivateKey());
}

function getApnsJwt() {
  const key = decodeApnsPrivateKey();
  if (!key) return null;
  return jwt.sign(
    {
      iss: APNS_TEAM_ID,
      iat: Math.floor(Date.now() / 1000),
    },
    key,
    {
      algorithm: "ES256",
      header: {
        alg: "ES256",
        kid: APNS_KEY_ID,
      },
    }
  );
}

function splitTokensByPlatform(rows: PushTokenRow[]) {
  const ios: string[] = [];
  const other: string[] = [];

  for (const row of rows) {
    const token = String(row?.token || "").trim();
    if (!token) continue;
    const platform = normalizePlatform(row?.platform);
    if (platform === "ios") ios.push(token);
    else other.push(token);
  }

  return {
    ios: Array.from(new Set(ios)),
    other: Array.from(new Set(other)),
  };
}

async function sendViaFcm(tokens: string[], payload: PushPayload) {
  if (!canSendFcm()) return { ok: false, skipped: true, reason: "FCM_SERVER_KEY missing", sent: 0 };
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
            sound: payload.sound || "default",
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

async function deactivatePushToken(token: string, reason?: string | null) {
  const clean = String(token || "").trim();
  if (!clean) return;
  try {
    await supabaseAdmin
      .from("user_push_tokens")
      .update({
        active: false,
        updated_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("token", clean);
    console.warn("[push] deactivated token", {
      tokenPrefix: clean.slice(0, 12),
      reason: reason || "unknown",
    });
  } catch (error: any) {
    console.warn("[push] failed to deactivate token", {
      tokenPrefix: clean.slice(0, 12),
      reason: reason || "unknown",
      error: error?.message || String(error),
    });
  }
}

async function sendViaApns(tokens: string[], payload: PushPayload) {
  if (!canSendApns()) return { ok: false, skipped: true, reason: "APNS credentials missing", sent: 0 };
  if (!tokens.length) return { ok: true, sent: 0 };

  const providerToken = getApnsJwt();
  if (!providerToken) return { ok: false, skipped: true, reason: "APNS token generation failed", sent: 0 };

  const host = APNS_PRODUCTION ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const client = http2.connect(host);
  let sent = 0;

  try {
    for (const deviceToken of tokens) {
      const result = await new Promise<{ status: number; body: string }>((resolve) => {
        const req = client.request({
          ":method": "POST",
          ":path": `/3/device/${deviceToken}`,
          authorization: `bearer ${providerToken}`,
          "apns-topic": APNS_BUNDLE_ID,
          "apns-push-type": "alert",
          "apns-priority": "10",
        });

        let responseStatus = 0;
        let responseBody = "";
        req.on("response", (headers) => {
          responseStatus = Number(headers[http2.constants.HTTP2_HEADER_STATUS] || 0);
        });
        req.on("data", (chunk) => {
          responseBody += String(chunk || "");
        });
        req.on("error", (error) => {
          console.error("[push][apns] request error", {
            tokenPrefix: deviceToken.slice(0, 12),
            error: error?.message || String(error),
          });
          resolve({ status: 0, body: "" });
        });
        req.on("end", () => resolve({ status: responseStatus, body: responseBody }));
        req.setEncoding("utf8");
        req.write(
          JSON.stringify({
            aps: {
              alert: {
                title: payload.title,
                body: payload.body,
              },
              sound: payload.sound || "default",
              badge: Number(payload.badge || 1),
            },
            data: payload.data || {},
          })
        );
        req.end();
      });

      if (result.status >= 200 && result.status < 300) {
        sent += 1;
        console.log("[push][apns] delivered", {
          tokenPrefix: deviceToken.slice(0, 12),
          status: result.status,
          topic: APNS_BUNDLE_ID,
          environment: APNS_PRODUCTION ? "production" : "sandbox",
        });
      } else {
        let parsedBody: any = null;
        try {
          parsedBody = result.body ? JSON.parse(result.body) : null;
        } catch {}
        console.error("[push][apns] rejected", {
          tokenPrefix: deviceToken.slice(0, 12),
          status: result.status,
          topic: APNS_BUNDLE_ID,
          environment: APNS_PRODUCTION ? "production" : "sandbox",
          body: result.body || null,
        });
        const reason = String(parsedBody?.reason || "");
        if (result.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken") {
          await deactivatePushToken(deviceToken, reason || `apns-${result.status}`);
        }
      }
    }
  } finally {
    client.close();
  }

  return { ok: true, sent };
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
    if ((!canSendFcm() && !canSendApns()) || !Array.isArray(userIds) || userIds.length === 0) {
      return {
        ok: false,
        skipped: true,
        reason: !canSendFcm() && !canSendApns() ? "No APNS or FCM credentials configured" : "No users",
        sent: 0,
      };
    }

    const uniqueUserIds = Array.from(new Set(userIds.map((x) => String(x || "").trim()).filter(Boolean)));
    if (!uniqueUserIds.length) return { ok: true, sent: 0 };

    const { data: rows, error } = await supabaseAdmin
      .from("user_push_tokens")
      .select("token,user_id,platform")
      .in("user_id", uniqueUserIds)
      .eq("active", true);

    if (error) return { ok: false, error };
    const { ios, other } = splitTokensByPlatform((rows || []) as PushTokenRow[]);
    console.log("[push] resolved tokens", {
      users: uniqueUserIds.length,
      ios: ios.length,
      other: other.length,
      apnsConfigured: canSendApns(),
      fcmConfigured: canSendFcm(),
      apnsEnvironment: APNS_PRODUCTION ? "production" : "sandbox",
      topic: APNS_BUNDLE_ID || null,
    });

    const apnsResult = ios.length ? await sendViaApns(ios, payload) : { ok: true, sent: 0 };
    const fcmTargets = other.length || !ios.length || !canSendApns() ? [...other, ...(canSendApns() ? [] : ios)] : other;
    const fcmResult = fcmTargets.length ? await sendViaFcm(Array.from(new Set(fcmTargets)), payload) : { ok: true, sent: 0 };

    console.log("[push] delivery result", {
      sent: Number(apnsResult.sent || 0) + Number(fcmResult.sent || 0),
      apns: apnsResult,
      fcm: fcmResult,
    });

    return {
      ok: Boolean(apnsResult.ok && fcmResult.ok),
      sent: Number(apnsResult.sent || 0) + Number(fcmResult.sent || 0),
      apns: apnsResult,
      fcm: fcmResult,
    };
  }
}
