import crypto from "crypto";
import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";
import { supabaseAdmin } from "../supabase/supabaseClient";
import { logger } from "../observability/logger";
import { initAdaptersOnce } from "../device/adapters/initAdapters";
import { adapterRegistry } from "../device/adapters/registry";

export type CapabilityStatus =
  | "supported"
  | "unsupported"
  | "unknown"
  | "temporarily_unavailable"
  | "permission_denied"
  | "setup_incomplete"
  | "provider_disconnected";

type CapabilityEvidence = {
  codes?: string[];
  reason?: string;
  provider?: string;
};

function clean(value: any) {
  return String(value ?? "").trim();
}

function lower(value: any) {
  return clean(value).toLowerCase();
}

function record(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function codeOf(item: any) {
  return lower(item?.code || item?.dp_code || item?.key || item?.name || item);
}

function firstCode(codes: Set<string>, matcher: RegExp) {
  return Array.from(codes).find((code) => matcher.test(code)) || null;
}

function status(status: CapabilityStatus, evidence: CapabilityEvidence = {}) {
  return { status, ...evidence };
}

function boolValue(value: any): boolean | null {
  if (value === true || value === false) return value;
  const raw = lower(value);
  if (["1", "true", "on", "yes", "active", "open", "opened", "unlock", "unlocked", "alarm"].includes(raw)) return true;
  if (["0", "false", "off", "no", "inactive", "closed", "lock", "locked", "normal"].includes(raw)) return false;
  return null;
}

function numberValue(...values: any[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function masked(value: any) {
  const raw = clean(value);
  if (!raw) return null;
  if (raw.length <= 4) return "••••";
  return `${raw.slice(0, 1)}••••${raw.slice(-2)}`;
}

function safeMetadata(device: any) {
  const metadata = record(device?.metadata);
  const raw = record(metadata.raw);
  return {
    category: clean(raw.category || metadata.category || device?.category || device?.type),
    product_id: clean(raw.product_id || metadata.product_id),
    product_name: clean(raw.product_name || metadata.product_name),
    model: clean(raw.model || metadata.model),
    owner_id_present: Boolean(raw.owner_id || metadata.owner_id),
  };
}

function smartAccessFamily(device: any, summary: any, codes: Set<string>) {
  const haystack = [
    summary.device_family,
    summary.control_profile,
    device?.category,
    device?.type,
    device?.name,
    device?.metadata?.raw?.category,
    device?.metadata?.product_name,
    device?.metadata?.model,
    Array.from(codes).join(" "),
  ].map(lower).join(" ");
  return /\b(lock|doorlock|smart_lock|door_lock|jtms|jtmspro|jtmsbh|ms|access_control|unlock|temporary|password|fingerprint)\b/.test(haystack);
}

export function buildSmartAccessProfile(device: any, stateRow?: any | null) {
  const summary = summarizeDeviceFrontendContract(device || {}, stateRow || null);
  const metadata = record(device?.metadata);
  const raw = record(metadata.raw);
  const functionItems = [
    ...array(metadata.functions),
    ...array(raw.functions),
    ...array(stateRow?.functions),
    ...array(stateRow?.state?.functions),
  ];
  const statusItems = [
    ...array(raw.status),
    ...array(metadata.status),
    ...array(stateRow?.state?.__raw),
  ];
  const codes = new Set<string>();
  for (const item of functionItems) {
    const code = codeOf(item);
    if (code) codes.add(code);
  }
  for (const item of statusItems) {
    const code = codeOf(item);
    if (code) codes.add(code);
  }
  for (const code of array(summary.capability_codes)) {
    const next = lower(code);
    if (next) codes.add(next);
  }
  for (const code of array(summary.supported_controls)) {
    const next = lower(code);
    if (next) codes.add(next);
  }

  const isSmartAccess = smartAccessFamily(device, summary, codes);
  const provider = lower(device?.provider || device?.vendor || device?.adapter || "unknown") || "unknown";
  const providerDisconnected = summary.provider_health === "authorization_required" || summary.provider_health === "degraded";
  const providerStatus: CapabilityStatus = providerDisconnected ? "temporarily_unavailable" : isSmartAccess ? "supported" : "unsupported";
  const remoteLockCode = firstCode(codes, /^(remote_)?lock$|lock_switch|switch$/);
  const remoteUnlockCode = firstCode(codes, /^unlock$|remote_unlock|unlock_switch|remote_no_dp_key|switch$/);
  const lockStateCode = firstCode(codes, /lock_state|status_lock|closed_opened|door_state|open_close|doorcontact_state/);
  const batteryCode = firstCode(codes, /battery|electricity|va_battery/);
  const credentialCodes = Array.from(codes).filter((code) => /temporary|password|pin|code|dynamic|one_time|clear|ticket|schedule/.test(code));
  const memberCodes = Array.from(codes).filter((code) => /member|user|family|guest|owner/.test(code));
  const historyCodes = Array.from(codes).filter((code) => /record|history|log|unlock_record|access/.test(code));
  const securityCodes = Array.from(codes).filter((code) => /tamper|hijack|wrong|trial|attempt|alarm|forced|jam|low/.test(code));
  const mediaCodes = Array.from(codes).filter((code) => /camera|video|stream|snapshot|image|media|clip|recording|motion|audio/.test(code));
  const doorbellCodes = Array.from(codes).filter((code) => /doorbell|bell|press|call/.test(code));
  const settingsCodes = Array.from(codes).filter((code) => /auto_lock|passage|volume|privacy|language|sound|setting/.test(code));

  const capabilities = {
    state: {
      online: status(isSmartAccess ? "supported" : "unsupported", { codes: ["online"] }),
      lock_state: status(lockStateCode || remoteLockCode || remoteUnlockCode ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: [lockStateCode, remoteLockCode, remoteUnlockCode].filter(Boolean) as string[] }),
      door_state: status(lockStateCode ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: lockStateCode ? [lockStateCode] : [] }),
      battery: status(batteryCode ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: batteryCode ? [batteryCode] : [] }),
      security: status(securityCodes.length ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: securityCodes }),
    },
    control: {
      lock: status(remoteLockCode ? providerStatus : isSmartAccess ? "unsupported" : "unsupported", { codes: remoteLockCode ? [remoteLockCode] : [] }),
      unlock: status(remoteUnlockCode ? providerStatus : isSmartAccess ? "unsupported" : "unsupported", { codes: remoteUnlockCode ? [remoteUnlockCode] : [] }),
    },
    credentials: {
      temporary_code: status(credentialCodes.length ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: credentialCodes }),
      one_time_code: status(credentialCodes.some((code) => /one_time|dynamic/.test(code)) ? providerStatus : credentialCodes.length ? "unknown" : isSmartAccess ? "unknown" : "unsupported", { codes: credentialCodes }),
      revoke: status(credentialCodes.some((code) => /clear|delete|remove|revoke/.test(code)) ? providerStatus : credentialCodes.length ? "unknown" : isSmartAccess ? "unknown" : "unsupported", { codes: credentialCodes }),
    },
    members: {
      list: status(memberCodes.length ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: memberCodes }),
      manage: status(memberCodes.length ? "setup_incomplete" : isSmartAccess ? "unknown" : "unsupported", { codes: memberCodes, reason: memberCodes.length ? "Provider member APIs must confirm write support before Oyi enables management." : undefined }),
    },
    history: {
      access_records: status(historyCodes.length || isSmartAccess ? providerStatus : "unsupported", { codes: historyCodes, reason: historyCodes.length ? undefined : "Provider history may be available through a dedicated API." }),
    },
    security: {
      tamper: status(securityCodes.length ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: securityCodes }),
      wrong_attempt: status(securityCodes.some((code) => /wrong|trial|attempt/.test(code)) ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: securityCodes }),
      battery_low: status(batteryCode || securityCodes.some((code) => /battery|low/.test(code)) ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: [batteryCode, ...securityCodes].filter(Boolean) as string[] }),
    },
    doorbell: {
      events: status(doorbellCodes.length ? providerStatus : isSmartAccess ? "unsupported" : "unsupported", { codes: doorbellCodes }),
    },
    media: {
      live_view: status(mediaCodes.length ? providerStatus : "unsupported", { codes: mediaCodes }),
      snapshot: status(mediaCodes.some((code) => /snapshot|image/.test(code)) ? providerStatus : "unsupported", { codes: mediaCodes }),
      recordings: status(mediaCodes.some((code) => /recording|clip/.test(code)) ? providerStatus : "unsupported", { codes: mediaCodes }),
    },
    settings: {
      auto_lock: status(settingsCodes.some((code) => /auto_lock/.test(code)) ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: settingsCodes }),
      passage_mode: status(settingsCodes.some((code) => /passage/.test(code)) ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { codes: settingsCodes }),
    },
  };

  const state = normalizeSmartAccessState(device, stateRow || summary);
  const evidence = {
    provider,
    metadata: safeMetadata(device),
    function_codes: Array.from(new Set(functionItems.map(codeOf).filter(Boolean))).sort(),
    status_codes: Array.from(new Set(statusItems.map(codeOf).filter(Boolean))).sort(),
    capability_codes: Array.from(codes).sort(),
  };
  const rawFingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({ provider, metadata: evidence.metadata, codes: evidence.capability_codes }))
    .digest("hex");

  return {
    is_smart_access: isSmartAccess,
    device_family: isSmartAccess ? "smart_access" : summary.device_family,
    control_profile: isSmartAccess ? "smart_access" : summary.control_profile,
    provider,
    provider_category: evidence.metadata.category || null,
    provider_product_id: evidence.metadata.product_id || null,
    provider_model: evidence.metadata.model || null,
    capabilities,
    supported_controls: smartAccessSupportedControls(capabilities),
    capability_codes: Array.from(codes).sort(),
    state,
    evidence,
    confidence: {
      classification: isSmartAccess ? (evidence.function_codes.length || evidence.status_codes.length ? "high" : "medium") : "low",
      source_count: evidence.capability_codes.length,
    },
    raw_fingerprint: rawFingerprint,
  };
}

export function smartAccessSupportedControls(capabilities: any) {
  const controls: string[] = ["smart_access"];
  if (capabilities?.state?.lock_state?.status === "supported") controls.push("lock_state");
  if (capabilities?.control?.lock?.status === "supported") controls.push("lock");
  if (capabilities?.control?.unlock?.status === "supported") controls.push("unlock");
  if (capabilities?.state?.battery?.status === "supported") controls.push("battery_level");
  if (capabilities?.history?.access_records?.status === "supported") controls.push("access_records");
  if (capabilities?.credentials?.temporary_code?.status === "supported") controls.push("temporary_access_code");
  if (capabilities?.members?.list?.status === "supported") controls.push("access_members");
  if (capabilities?.doorbell?.events?.status === "supported") controls.push("doorbell_events");
  if (capabilities?.media?.live_view?.status === "supported") controls.push("media_session");
  return Array.from(new Set(controls));
}

export function normalizeSmartAccessState(device: any, runtime?: any | null) {
  const state = record(runtime?.state || runtime);
  const normalized = record(runtime?.normalized_state);
  const metadata = record(device?.metadata);
  const rawStatus = array(metadata.raw?.status);
  const rawMap = rawStatus.reduce((acc: Record<string, any>, item: any) => {
    const code = codeOf(item);
    if (code) acc[code] = item?.value;
    return acc;
  }, {});
  const source = { ...rawMap, ...state, ...normalized };
  const online = boolValue(source.online ?? device?.online ?? device?.status);
  const lockedBool = boolValue(source.locked ?? source.lock ?? source.lock_state ?? source.status_lock ?? source.closed_opened);
  const doorOpen = boolValue(source.door_open ?? source.door_state ?? source.open_close ?? source.doorcontact_state);
  const batteryPercentage = numberValue(source.battery_percentage, source.battery, source.electricity, source.va_battery);
  const tamperActive = boolValue(source.tamper ?? source.hijack ?? source.anti_lock_outside ?? source.alarm);
  const wrongAttemptActive = boolValue(source.wrong_attempt ?? source.trial_error ?? source.unlock_wrong ?? source.wrong_finger);
  const batteryLow = batteryPercentage !== null ? batteryPercentage <= 20 : boolValue(source.battery_low ?? source.low_battery);
  return {
    online,
    locked: lockedBool,
    lockState: lockedBool === true ? "locked" : lockedBool === false ? "unlocked" : null,
    doorOpen,
    batteryPercentage,
    batteryLow: batteryLow === true,
    tamperActive: tamperActive === true,
    wrongAttemptActive: wrongAttemptActive === true,
    lastAccessEvent: runtime?.last_access_event || runtime?.lastAccessEvent || null,
  };
}

export async function persistSmartAccessSnapshot(device: any, input?: { source?: string; stateRow?: any | null; detectionError?: any }) {
  let hydratedDevice = device;
  let detectionError = input?.detectionError || null;
  try {
    initAdaptersOnce();
    const providerName = lower(device?.adapter || device?.provider || device?.vendor);
    const adapter = providerName ? adapterRegistry.get(providerName) : null;
    if (adapter?.discoverCapabilities && device?.external_id) {
      const evidence = await adapter.discoverCapabilities(device.external_id, {
        estateId: device.estate_id,
        homeId: device.home_id || undefined,
        userId: device.owner_user_id || device.metadata?.oyi?.integration_owner_user_id || "system",
        credentials: {},
      });
      hydratedDevice = {
        ...device,
        metadata: {
          ...(record(device.metadata)),
          functions: array(evidence?.functions),
          raw: {
            ...(record(device.metadata?.raw)),
            category: evidence?.category || device.metadata?.raw?.category,
            product_id: evidence?.product_id || device.metadata?.raw?.product_id,
            product_name: evidence?.product_name || device.metadata?.raw?.product_name,
            model: evidence?.model || device.metadata?.raw?.model,
            functions: array(evidence?.functions),
          },
          provider_capability_evidence: {
            source: evidence?.source || "adapter",
            function_codes: array(evidence?.function_codes),
          },
        },
      };
    }
  } catch (error: any) {
    detectionError = error;
  }

  const profile = buildSmartAccessProfile(hydratedDevice, input?.stateRow || null);
  if (!profile.is_smart_access || !device?.id) return profile;
  const now = new Date().toISOString();
  const row = {
    device_id: device.id,
    estate_id: device.estate_id,
    home_id: device.home_id || null,
    provider: profile.provider,
    provider_connection_id: device.provider_connection_id || null,
    provider_category: profile.provider_category,
    provider_product_id: profile.provider_product_id,
    provider_model: profile.provider_model,
    profile_version: 1,
    capabilities: profile.capabilities,
    state_snapshot: profile.state,
    raw_fingerprint: profile.raw_fingerprint,
    detected_at: now,
    last_verified_at: now,
    detection_source: input?.source || "runtime",
    detection_error: detectionError ? { message: String(detectionError?.message || detectionError) } : null,
    confidence: profile.confidence,
    evidence: profile.evidence,
    updated_at: now,
  };
  const { error } = await supabaseAdmin
    .from("smart_access_capability_snapshots")
    .upsert(row as any, { onConflict: "device_id,raw_fingerprint" });
  if (error) {
    logger.warn("smart_access_snapshot_persist_failed", {
      device_id: device.id,
      estate_id: device.estate_id,
      home_id: device.home_id || null,
      error: error.message,
    });
  }
  const metadata = {
    ...(record(hydratedDevice.metadata)),
    smart_access: {
      profile_version: 1,
      detected_at: now,
      last_verified_at: now,
      capabilities: profile.capabilities,
      state: profile.state,
      supported_controls: profile.supported_controls,
      raw_fingerprint: profile.raw_fingerprint,
    },
  };
  await supabaseAdmin.from("devices").update({ metadata, updated_at: now } as any).eq("id", device.id);
  return profile;
}

export async function getSmartAccessProfileForDevice(device: any, options: { refresh?: boolean; source?: string } = {}) {
  if (options.refresh) return persistSmartAccessSnapshot(device, { source: options.source || "manual_refresh" });
  const current = record(device?.metadata?.smart_access);
  if (current?.capabilities) {
    const profile = buildSmartAccessProfile(device, null);
    return {
      ...profile,
      capabilities: current.capabilities,
      state: current.state || profile.state,
      supported_controls: Array.isArray(current.supported_controls) ? current.supported_controls : profile.supported_controls,
      raw_fingerprint: current.raw_fingerprint || profile.raw_fingerprint,
    };
  }
  return persistSmartAccessSnapshot(device, { source: options.source || "first_read" });
}

export async function listSmartAccessRecords(device: any, limit = 30) {
  const { data, error } = await supabaseAdmin
    .from("smart_access_records")
    .select("id,event_type,access_method,subject_label_masked,occurred_at,severity,privacy_scope,evidence")
    .eq("device_id", device.id)
    .eq("estate_id", device.estate_id)
    .eq("home_id", device.home_id)
    .order("occurred_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;
  return data || [];
}

export async function listSmartAccessCredentials(device: any) {
  const { data, error } = await supabaseAdmin
    .from("smart_access_credentials")
    .select("id,credential_type,subject_label_masked,status,effective_at,expires_at,schedule,created_at,revoked_at")
    .eq("device_id", device.id)
    .eq("estate_id", device.estate_id)
    .eq("home_id", device.home_id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export async function createUnsupportedCredentialRecord(device: any, input: any, actorId?: string | null) {
  const profile = await getSmartAccessProfileForDevice(device);
  if (profile.capabilities?.credentials?.temporary_code?.status !== "supported") {
    const error: any = new Error("Temporary access codes are not confirmed for this lock.");
    error.statusCode = 400;
    error.code = "smart_access_credential_unsupported";
    throw error;
  }
  const code = clean(input?.code);
  if (!/^\d{4,10}$/.test(code)) {
    const error: any = new Error("Access code must contain 4 to 10 digits.");
    error.statusCode = 400;
    error.code = "smart_access_credential_invalid";
    throw error;
  }
  const { data, error } = await supabaseAdmin
    .from("smart_access_credentials")
    .insert({
      device_id: device.id,
      estate_id: device.estate_id,
      home_id: device.home_id,
      provider_connection_id: device.provider_connection_id || null,
      credential_type: clean(input?.credential_type || "temporary_code"),
      subject_label_masked: masked(input?.subject_label || input?.visitor_name || "Guest"),
      status: "setup_incomplete",
      effective_at: input?.effective_at || null,
      expires_at: input?.expires_at || null,
      schedule: record(input?.schedule),
      metadata: { provider_confirmation_required: true },
      created_by: actorId || null,
    } as any)
    .select("id,credential_type,subject_label_masked,status,effective_at,expires_at,schedule,created_at")
    .single();
  if (error) throw error;
  return data;
}
