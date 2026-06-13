import { supabaseAdmin } from "../supabase/supabaseClient";
import type { NotificationPayload } from "./NotificationService";

export type NotificationCategory = "security" | "visitors" | "maintenance" | "services" | "wallet" | "proximity" | "devices" | "automation" | "community" | "intelligence";
export type NotificationDecision = "activity_only" | "in_app" | "push" | "critical_push" | "digest" | "suppressed";

export type NotificationPreference = {
  category: NotificationCategory;
  push_enabled: boolean;
  in_app_enabled: boolean;
  critical_only: boolean;
  digest_mode: boolean;
  cooldown_minutes: number;
  quiet_hours: Record<string, any>;
};

const CATEGORIES: NotificationCategory[] = ["security", "visitors", "maintenance", "services", "wallet", "proximity", "devices", "automation", "community", "intelligence"];

const DEFAULTS: Record<NotificationCategory, NotificationPreference> = {
  security: { category: "security", push_enabled: true, in_app_enabled: true, critical_only: false, digest_mode: false, cooldown_minutes: 5, quiet_hours: {} },
  visitors: { category: "visitors", push_enabled: true, in_app_enabled: true, critical_only: false, digest_mode: false, cooldown_minutes: 10, quiet_hours: {} },
  maintenance: { category: "maintenance", push_enabled: true, in_app_enabled: true, critical_only: false, digest_mode: false, cooldown_minutes: 30, quiet_hours: {} },
  services: { category: "services", push_enabled: true, in_app_enabled: true, critical_only: false, digest_mode: false, cooldown_minutes: 60, quiet_hours: {} },
  wallet: { category: "wallet", push_enabled: true, in_app_enabled: true, critical_only: false, digest_mode: false, cooldown_minutes: 60, quiet_hours: {} },
  proximity: { category: "proximity", push_enabled: true, in_app_enabled: true, critical_only: false, digest_mode: false, cooldown_minutes: 30, quiet_hours: {} },
  devices: { category: "devices", push_enabled: false, in_app_enabled: false, critical_only: true, digest_mode: false, cooldown_minutes: 60, quiet_hours: {} },
  automation: { category: "automation", push_enabled: false, in_app_enabled: false, critical_only: true, digest_mode: false, cooldown_minutes: 60, quiet_hours: {} },
  community: { category: "community", push_enabled: false, in_app_enabled: true, critical_only: false, digest_mode: true, cooldown_minutes: 120, quiet_hours: {} },
  intelligence: { category: "intelligence", push_enabled: false, in_app_enabled: true, critical_only: false, digest_mode: true, cooldown_minutes: 120, quiet_hours: {} },
};

export function defaultNotificationPreferences() {
  return CATEGORIES.map((category) => ({ ...DEFAULTS[category] }));
}

export function normalizeNotificationCategory(input: any): NotificationCategory {
  const text = String(input || "").toLowerCase();
  if (/security|incident|alarm|motion|emergency|critical/.test(text)) return "security";
  if (/visitor|guest|gate|access/.test(text)) return "visitors";
  if (/maintenance|repair|ticket|support/.test(text)) return "maintenance";
  if (/service|utility|electric|water|internet|fee|charge/.test(text)) return "services";
  if (/wallet|payment|billing|transaction/.test(text)) return "wallet";
  if (/proximity|near_home|leaving_home|away|approaching/.test(text)) return "proximity";
  if (/device|light|switch|socket|relay|offline|online|command/.test(text)) return "devices";
  if (/automation|scene/.test(text)) return "automation";
  if (/community|post|comment|mention|notice|announcement/.test(text)) return "community";
  return "intelligence";
}

function severityText(notification: NotificationPayload) {
  return `${notification.type || ""} ${notification.title || ""} ${notification.message || ""} ${(notification.payload as any)?.severity || ""} ${(notification.payload as any)?.kind || ""}`.toLowerCase();
}

export function notificationKeyFor(userId: string, notification: NotificationPayload, category?: NotificationCategory) {
  const payload = notification.payload || {};
  const cat = category || normalizeNotificationCategory(`${notification.type} ${notification.title} ${notification.message} ${(payload as any).kind}`);
  const entity = notification.entityId || (payload as any).visitor_id || (payload as any).request_id || (payload as any).device_id || (payload as any).transaction_id || (payload as any).post_id || (payload as any).home_id || "general";
  const kind = String((payload as any).kind || notification.type || cat).replace(/\s+/g, "_");
  return `${cat}:${userId}:${entity}:${kind}`.slice(0, 240);
}

async function loadPreference(userId: string, category: NotificationCategory): Promise<NotificationPreference> {
  const fallback = DEFAULTS[category];
  const { data, error } = await supabaseAdmin
    .from("user_notification_preferences")
    .select("category,push_enabled,in_app_enabled,critical_only,digest_mode,cooldown_minutes,quiet_hours")
    .eq("user_id", userId)
    .eq("category", category)
    .maybeSingle();
  if (error || !data) return { ...fallback };
  return {
    category,
    push_enabled: data.push_enabled !== false,
    in_app_enabled: data.in_app_enabled !== false,
    critical_only: data.critical_only === true,
    digest_mode: data.digest_mode === true,
    cooldown_minutes: Number.isFinite(Number(data.cooldown_minutes)) ? Number(data.cooldown_minutes) : fallback.cooldown_minutes,
    quiet_hours: data.quiet_hours && typeof data.quiet_hours === "object" ? data.quiet_hours : {},
  };
}

function isCritical(notification: NotificationPayload) {
  return /critical|security|emergency|alarm|lockdown|tamper|intrusion|motion detected|leak|fire/.test(severityText(notification));
}

function isSelfInitiatedNormal(notification: NotificationPayload) {
  const text = severityText(notification);
  const source = String((notification.payload as any)?.source || "").toLowerCase();
  if (/device\.command\.executed|scene.*activated|automation.*executed/.test(text) && /app|watch|scene|automation|facility/.test(source)) return true;
  if (notification.type === "device" && /turned on|turned off|command executed|is now on|is now off/.test(text) && !/offline|failed|critical/.test(text)) return true;
  return false;
}

async function recentlyDecided(userId: string, key: string, cooldownMinutes: number) {
  if (!cooldownMinutes) return false;
  const since = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("notification_decisions")
    .select("id")
    .eq("user_id", userId)
    .eq("notification_key", key)
    .gte("created_at", since)
    .limit(1);
  if (error) return false;
  return Boolean((data || []).length);
}

export async function decideNotification(userId: string, notification: NotificationPayload) {
  const payload = notification.payload || {};
  const category = normalizeNotificationCategory(`${notification.type} ${notification.title} ${notification.message} ${(payload as any).kind}`);
  const preference = await loadPreference(userId, category);
  const key = String((payload as any).notification_key || notificationKeyFor(userId, notification, category));
  const critical = isCritical(notification);
  let decision: NotificationDecision = "in_app";
  let reason = "default_in_app";

  if (isSelfInitiatedNormal(notification)) {
    decision = "activity_only";
    reason = "self_initiated_activity";
  } else if (critical) {
    decision = preference.push_enabled ? "critical_push" : preference.in_app_enabled ? "in_app" : "activity_only";
    reason = "critical_event";
  } else if (preference.digest_mode) {
    decision = preference.in_app_enabled ? "digest" : "activity_only";
    reason = "digest_preference";
  } else if (preference.critical_only) {
    decision = preference.in_app_enabled ? "in_app" : "activity_only";
    reason = "critical_only_preference";
  } else if (preference.push_enabled && ["visitors", "maintenance", "services", "wallet", "proximity", "security"].includes(category)) {
    decision = "push";
    reason = "attention_category";
  } else if (preference.in_app_enabled) {
    decision = "in_app";
    reason = "in_app_enabled";
  } else {
    decision = "activity_only";
    reason = "category_activity_only";
  }

  if (["push", "critical_push", "in_app", "digest"].includes(decision) && await recentlyDecided(userId, key, preference.cooldown_minutes)) {
    decision = "suppressed";
    reason = "cooldown_duplicate";
  }

  return { decision, category, preference, key, reason, critical };
}

export async function recordNotificationDecision(input: { userId: string; estateId?: string | null; homeId?: string | null; key: string; category: NotificationCategory; decision: NotificationDecision; title?: string; reason?: string }) {
  await supabaseAdmin.from("notification_decisions").insert({
    user_id: input.userId,
    estate_id: input.estateId || null,
    home_id: input.homeId || null,
    notification_key: input.key,
    category: input.category,
    decision: input.decision,
    title: input.title || null,
    reason: input.reason || null,
  } as any).then(({ error }) => {
    if (error) console.warn("[notification_policy] decision log failed", error.message);
  });
}

export async function getUserNotificationPreferences(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_notification_preferences")
    .select("category,push_enabled,in_app_enabled,critical_only,digest_mode,cooldown_minutes,quiet_hours")
    .eq("user_id", userId);
  const map = new Map((data || []).map((row: any) => [String(row.category), row]));
  return defaultNotificationPreferences().map((pref) => ({ ...pref, ...(map.get(pref.category) || {}) }));
}

export async function upsertUserNotificationPreference(userId: string, category: NotificationCategory, patch: Partial<NotificationPreference>) {
  if (!CATEGORIES.includes(category)) throw Object.assign(new Error("Invalid notification category"), { statusCode: 400 });
  const fallback = DEFAULTS[category];
  const row = {
    user_id: userId,
    category,
    push_enabled: typeof patch.push_enabled === "boolean" ? patch.push_enabled : fallback.push_enabled,
    in_app_enabled: typeof patch.in_app_enabled === "boolean" ? patch.in_app_enabled : fallback.in_app_enabled,
    critical_only: typeof patch.critical_only === "boolean" ? patch.critical_only : fallback.critical_only,
    digest_mode: typeof patch.digest_mode === "boolean" ? patch.digest_mode : fallback.digest_mode,
    cooldown_minutes: Number.isFinite(Number(patch.cooldown_minutes)) ? Math.max(0, Math.min(1440, Number(patch.cooldown_minutes))) : fallback.cooldown_minutes,
    quiet_hours: patch.quiet_hours && typeof patch.quiet_hours === "object" ? patch.quiet_hours : fallback.quiet_hours,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from("user_notification_preferences").upsert(row, { onConflict: "user_id,category" }).select().single();
  if (error) throw error;
  return data;
}
