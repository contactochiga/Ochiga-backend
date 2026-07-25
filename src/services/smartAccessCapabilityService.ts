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
  | "provider_disconnected"
  | "provider_declared_only"
  | "mapping_missing"
  | "verification_required";

type CapabilityEvidence = {
  declaredByProvider?: boolean;
  readableByOyi?: boolean;
  executableByOyi?: boolean;
  liveVerified?: boolean;
  sourceCodes?: string[];
  reason?: string;
  provider?: string;
  verifiedAt?: string;
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

function status(statusValue: CapabilityStatus, evidence: CapabilityEvidence = {}) {
  return {
    declaredByProvider: Boolean(evidence.declaredByProvider),
    readableByOyi: Boolean(evidence.readableByOyi),
    executableByOyi: Boolean(evidence.executableByOyi),
    liveVerified: Boolean(evidence.liveVerified),
    status: statusValue,
    reason: evidence.reason,
    sourceCodes: evidence.sourceCodes || [],
    provider: evidence.provider,
    verifiedAt: evidence.verifiedAt,
  };
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

function lockOperationMatrix(codes: Set<string>, capabilities: any) {
  const has = (pattern: RegExp) => Array.from(codes).some((code) => pattern.test(code));
  const statusFor = (implemented: boolean, declared: boolean, blocker: string) => ({
    provider_declared: declared,
    cloud_api_exists: implemented,
    project_permission_available: implemented,
    gateway_required: /gateway/.test(blocker),
    bluetooth_required: /bluetooth|ble/.test(blocker),
    native_sdk_required: /native|sdk|bluetooth|ble/.test(blocker),
    physical_confirmation_required: /physical|fingerprint|card|enrol/.test(blocker),
    implemented,
    executable: implemented,
    live_verified: false,
    blocker: implemented ? "Live verification required before high-risk operation is marked verified." : blocker,
  });
  const remoteLock = capabilities?.control?.lock;
  const remoteUnlock = capabilities?.control?.unlock;
  return [
    ["remote_lock", statusFor(remoteLock?.executableByOyi === true, remoteLock?.declaredByProvider === true, "No safe Tuya cloud lock mapping is enabled for this project connection.")],
    ["remote_unlock", statusFor(remoteUnlock?.executableByOyi === true, remoteUnlock?.declaredByProvider === true, "No safe Tuya cloud unlock mapping is enabled. Tuya lock remote unlock can require Smart Lock Open Service permission and Remote Unlock enabled in Smart Life.")],
    ["bluetooth_unlock", statusFor(false, has(/unlock_ble|ble_unlock|bluetooth/), "Bluetooth unlock requires Tuya native/BLE lock SDK, local proximity, and secure native key storage.")],
    ["custom_pin", statusFor(false, has(/password|temporary_password|unlock_password/), "PIN management requires Tuya Smart Lock API/SDK credential workflow and must not be enabled from DP declaration alone.")],
    ["time_limited_pin", statusFor(false, has(/temporary_password|offline_time|schedule/), "Time-limited PINs require provider credential APIs and live permission verification.")],
    ["one_time_pin", statusFor(false, has(/dynamic|one_time|unlock_dynamic/), "One-time/dynamic PINs require provider lock SDK support and live verification.")],
    ["offline_pin", statusFor(false, has(/offline|unlock_offline/), "Offline PIN operations require provider lock SDK/API support and secure local handling.")],
    ["pin_modify_delete", statusFor(false, has(/password.*modify|password.*delete|temporary_password_modify|temporary_password_delete/), "PIN modification/deletion requires provider credential APIs; Oyi will not infer it from schema codes.")],
    ["member_create_delete", statusFor(false, has(/member|user|family|guest/), "Member management requires provider lock/member API support; lock members are not Oyi residents automatically.")],
    ["fingerprint_enrol_delete", statusFor(false, has(/fingerprint/), "Fingerprint enrolment/deletion usually requires physical lock interaction and/or native SDK support.")],
    ["card_enrol_delete", statusFor(false, has(/card/), "Card enrolment/deletion usually requires physical lock interaction and/or native SDK support.")],
    ["access_records", statusFor(false, capabilities?.history?.access_records?.declaredByProvider === true, "Access records require a readable provider history API or webhook/event subscription.")],
    ["lock_alarms", statusFor(capabilities?.security?.tamper?.readableByOyi === true, capabilities?.security?.tamper?.declaredByProvider === true, "Alarm evidence is provider-declared until status/event delivery is verified.")],
    ["doorbell", statusFor(false, capabilities?.doorbell?.events?.declaredByProvider === true, "Doorbell support requires event subscription/webhook/status verification.")],
    ["auto_lock", statusFor(false, capabilities?.settings?.auto_lock?.declaredByProvider === true, "Auto-lock configuration requires a safe provider setting API.")],
    ["passage_mode", statusFor(false, capabilities?.settings?.passage_mode?.declaredByProvider === true, "Passage mode requires a safe provider setting API.")],
    ["reverse_lock", statusFor(false, has(/reverse_lock/), "Reverse-lock state/configuration requires provider-specific support verification.")],
    ["beep_volume", statusFor(false, has(/beep_volume|volume/), "Beep volume requires a safe provider setting API.")],
    ["lock_clock", statusFor(false, has(/rtc_lock|clock|time/), "Lock clock sync requires provider setting support.")],
    ["battery", statusFor(capabilities?.state?.battery?.readableByOyi === true, capabilities?.state?.battery?.declaredByProvider === true, "Battery is unavailable until provider state read succeeds.")],
    ["motor_state", statusFor(capabilities?.state?.security?.readableByOyi === true, has(/lock_motor_state/), "Motor state is provider-declared until readable state delivery is verified.")],
  ].map(([operation, details]) => ({ operation, ...(details as Record<string, any>) }));
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
  const rawRuntime = record(stateRow);
  const readSucceeded = Boolean(rawRuntime.state || rawRuntime.normalized_state || rawRuntime.provider_timestamp || rawRuntime.runtime_timestamp || evidenceFromStateRow(stateRow).length);
  const verifiedAt = clean(rawRuntime.provider_timestamp || rawRuntime.last_refresh || rawRuntime.runtime_timestamp) || undefined;
  const remoteLockDeclared = Array.from(codes).filter((code) => /^(remote_)?lock$|lock_switch|manual_lock|automatic_lock|rtc_lock|lock_motor_state/.test(code));
  const remoteUnlockDeclared = Array.from(codes).filter((code) => /^unlock|remote_no_dp_key|unlock_phone_remote|remote_pd|ble_unlock|check_code|dynamic|password|fingerprint|card/.test(code));
  const remoteLockExecutableCode = firstCode(codes, /^(remote_lock|lock)$/);
  const remoteUnlockExecutableCode = firstCode(codes, /^(remote_unlock|unlock)$/);
  const lockStateCode = firstCode(codes, /lock_state|status_lock|closed_opened|door_state|open_close|doorcontact_state/);
  const batteryCode = firstCode(codes, /battery|electricity|residual_electricity|va_battery/);
  const credentialCodes = Array.from(codes).filter((code) => /temporary|password|pin|code|dynamic|one_time|clear|ticket|schedule/.test(code));
  const memberCodes = Array.from(codes).filter((code) => /member|user|family|guest|owner/.test(code));
  const historyCodes = Array.from(codes).filter((code) => /record|history|log|unlock_record|access/.test(code));
  const securityCodes = Array.from(codes).filter((code) => /tamper|hijack|wrong|trial|attempt|alarm|forced|jam|low/.test(code));
  const mediaCodes = Array.from(codes).filter((code) => /camera|video|stream|snapshot|image|media|clip|recording|motion|audio/.test(code));
  const doorbellCodes = Array.from(codes).filter((code) => /doorbell|bell|press|call/.test(code));
  const settingsCodes = Array.from(codes).filter((code) => /auto_lock|passage|volume|privacy|language|sound|setting/.test(code));

  const capabilities = {
    state: {
      online: status(isSmartAccess ? "supported" : "unsupported", { declaredByProvider: isSmartAccess, readableByOyi: readSucceeded, liveVerified: readSucceeded, sourceCodes: ["online"], verifiedAt }),
      lock_state: status(lockStateCode ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(lockStateCode), readableByOyi: Boolean(lockStateCode && readSucceeded), liveVerified: Boolean(lockStateCode && readSucceeded), sourceCodes: lockStateCode ? [lockStateCode] : [], verifiedAt }),
      door_state: status(lockStateCode ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(lockStateCode), readableByOyi: Boolean(lockStateCode && readSucceeded), liveVerified: Boolean(lockStateCode && readSucceeded), sourceCodes: lockStateCode ? [lockStateCode] : [], verifiedAt }),
      battery: status(batteryCode ? providerStatus : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(batteryCode), readableByOyi: Boolean(batteryCode && readSucceeded), liveVerified: Boolean(batteryCode && readSucceeded), sourceCodes: batteryCode ? [batteryCode] : [], verifiedAt }),
      security: status(securityCodes.length ? (readSucceeded ? providerStatus : "provider_declared_only") : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(securityCodes.length), readableByOyi: Boolean(securityCodes.length && readSucceeded), liveVerified: Boolean(securityCodes.length && readSucceeded), sourceCodes: securityCodes, verifiedAt }),
    },
    control: {
      lock: status(remoteLockExecutableCode ? "verification_required" : remoteLockDeclared.length ? "mapping_missing" : isSmartAccess ? "unsupported" : "unsupported", { declaredByProvider: Boolean(remoteLockDeclared.length || remoteLockExecutableCode), executableByOyi: Boolean(remoteLockExecutableCode), liveVerified: false, sourceCodes: Array.from(new Set([remoteLockExecutableCode, ...remoteLockDeclared].filter(Boolean) as string[])), reason: remoteLockExecutableCode ? "Remote lock mapping exists but requires live verification before high-risk control is treated as verified." : remoteLockDeclared.length ? "Provider schema declares lock-related functions, but Oyi has no safe remote-lock command mapping for this connection." : undefined }),
      unlock: status(remoteUnlockExecutableCode ? "verification_required" : remoteUnlockDeclared.length ? "mapping_missing" : isSmartAccess ? "unsupported" : "unsupported", { declaredByProvider: Boolean(remoteUnlockDeclared.length || remoteUnlockExecutableCode), executableByOyi: Boolean(remoteUnlockExecutableCode), liveVerified: false, sourceCodes: Array.from(new Set([remoteUnlockExecutableCode, ...remoteUnlockDeclared].filter(Boolean) as string[])), reason: remoteUnlockExecutableCode ? "Remote unlock mapping exists but requires live verification before high-risk control is treated as verified." : remoteUnlockDeclared.length ? "Provider schema declares unlock methods, but Oyi has no safe cloud unlock command mapping for this connection." : undefined }),
    },
    credentials: {
      temporary_code: status(credentialCodes.length ? "provider_declared_only" : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(credentialCodes.length), executableByOyi: false, liveVerified: false, sourceCodes: credentialCodes, reason: credentialCodes.length ? "Temporary-code functions are declared by the provider, but Oyi has not verified the required provider credential workflow for this connection." : undefined }),
      one_time_code: status(credentialCodes.some((code) => /one_time|dynamic/.test(code)) ? "provider_declared_only" : credentialCodes.length ? "unknown" : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: credentialCodes.some((code) => /one_time|dynamic/.test(code)), executableByOyi: false, liveVerified: false, sourceCodes: credentialCodes }),
      revoke: status(credentialCodes.some((code) => /clear|delete|remove|revoke/.test(code)) ? "provider_declared_only" : credentialCodes.length ? "unknown" : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: credentialCodes.some((code) => /clear|delete|remove|revoke/.test(code)), executableByOyi: false, liveVerified: false, sourceCodes: credentialCodes }),
    },
    members: {
      list: status(memberCodes.length ? "provider_declared_only" : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(memberCodes.length), readableByOyi: false, sourceCodes: memberCodes }),
      manage: status(memberCodes.length ? "setup_incomplete" : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(memberCodes.length), executableByOyi: false, sourceCodes: memberCodes, reason: memberCodes.length ? "Provider member APIs must confirm write support before Oyi enables management." : undefined }),
    },
    history: {
      access_records: status(historyCodes.length ? "provider_declared_only" : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(historyCodes.length), readableByOyi: false, liveVerified: false, sourceCodes: historyCodes, reason: historyCodes.length ? "Provider access-record functions are declared, but Oyi has not verified a readable access-record API for this connection." : "Provider history may be available through a dedicated API." }),
    },
    security: {
      tamper: status(securityCodes.length ? (readSucceeded ? providerStatus : "provider_declared_only") : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(securityCodes.length), readableByOyi: Boolean(securityCodes.length && readSucceeded), sourceCodes: securityCodes, verifiedAt }),
      wrong_attempt: status(securityCodes.some((code) => /wrong|trial|attempt/.test(code)) ? (readSucceeded ? providerStatus : "provider_declared_only") : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: securityCodes.some((code) => /wrong|trial|attempt/.test(code)), readableByOyi: Boolean(readSucceeded), sourceCodes: securityCodes, verifiedAt }),
      battery_low: status(batteryCode || securityCodes.some((code) => /battery|low/.test(code)) ? (readSucceeded ? providerStatus : "provider_declared_only") : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: Boolean(batteryCode || securityCodes.some((code) => /battery|low/.test(code))), readableByOyi: Boolean(readSucceeded), sourceCodes: [batteryCode, ...securityCodes].filter(Boolean) as string[], verifiedAt }),
    },
    doorbell: {
      events: status(doorbellCodes.length ? "provider_declared_only" : isSmartAccess ? "unsupported" : "unsupported", { declaredByProvider: Boolean(doorbellCodes.length), readableByOyi: false, liveVerified: false, sourceCodes: doorbellCodes, reason: doorbellCodes.length ? "Doorbell is declared in provider schema, but event subscription has not been verified for Oyi." : undefined }),
    },
    media: {
      live_view: status(mediaCodes.length ? "provider_declared_only" : "unsupported", { declaredByProvider: Boolean(mediaCodes.length), readableByOyi: false, executableByOyi: false, liveVerified: false, sourceCodes: mediaCodes }),
      snapshot: status(mediaCodes.some((code) => /snapshot|image/.test(code)) ? "provider_declared_only" : "unsupported", { declaredByProvider: mediaCodes.some((code) => /snapshot|image/.test(code)), sourceCodes: mediaCodes }),
      recordings: status(mediaCodes.some((code) => /recording|clip/.test(code)) ? "provider_declared_only" : "unsupported", { declaredByProvider: mediaCodes.some((code) => /recording|clip/.test(code)), sourceCodes: mediaCodes }),
    },
    settings: {
      auto_lock: status(settingsCodes.some((code) => /auto_lock/.test(code)) ? "provider_declared_only" : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: settingsCodes.some((code) => /auto_lock/.test(code)), sourceCodes: settingsCodes }),
      passage_mode: status(settingsCodes.some((code) => /passage/.test(code)) ? "provider_declared_only" : isSmartAccess ? "unknown" : "unsupported", { declaredByProvider: settingsCodes.some((code) => /passage/.test(code)), sourceCodes: settingsCodes }),
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
    operation_matrix: lockOperationMatrix(codes, capabilities),
    state,
    evidence,
    confidence: {
      classification: isSmartAccess ? (evidence.function_codes.length || evidence.status_codes.length ? "high" : "medium") : "low",
      source_count: evidence.capability_codes.length,
    },
    raw_fingerprint: rawFingerprint,
  };
}

function evidenceFromStateRow(stateRow: any): string[] {
  return [
    ...array(stateRow?.state?.__raw),
    ...array(stateRow?.__raw),
  ].map(codeOf).filter(Boolean);
}

export function smartAccessSupportedControls(capabilities: any) {
  const controls: string[] = ["smart_access"];
  if (capabilities?.state?.lock_state?.status === "supported") controls.push("lock_state");
  if (capabilities?.control?.lock?.executableByOyi === true) controls.push("lock");
  if (capabilities?.control?.unlock?.executableByOyi === true) controls.push("unlock");
  if (capabilities?.state?.battery?.readableByOyi === true) controls.push("battery_level");
  if (capabilities?.history?.access_records?.readableByOyi === true) controls.push("access_records");
  if (capabilities?.credentials?.temporary_code?.executableByOyi === true) controls.push("temporary_access_code");
  if (capabilities?.members?.list?.readableByOyi === true) controls.push("access_members");
  if (capabilities?.doorbell?.events?.readableByOyi === true) controls.push("doorbell_events");
  if (capabilities?.media?.live_view?.executableByOyi === true) controls.push("media_session");
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
  const batteryPercentage = numberValue(source.battery_percentage, source.residual_electricity, source.battery, source.electricity, source.va_battery);
  const tamperActive = boolValue(source.tamper ?? source.hijack ?? source.anti_lock_outside ?? source.alarm);
  const wrongAttemptActive = boolValue(source.wrong_attempt ?? source.trial_error ?? source.unlock_wrong ?? source.wrong_finger);
  const batteryLow = batteryPercentage !== null ? batteryPercentage <= 20 : boolValue(source.battery_low ?? source.low_battery);
  return {
    online,
    locked: lockedBool,
    lockState: lockedBool === true ? "locked" : lockedBool === false ? "unlocked" : null,
    doorOpen,
    batteryPercentage,
    batteryLevel: batteryPercentage === null ? "unknown" : batteryPercentage <= 20 ? "critical" : batteryPercentage <= 35 ? "low" : "normal",
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

function hasCapabilityEvidenceModel(capabilities: any) {
  const unlock = capabilities?.control?.unlock;
  const battery = capabilities?.state?.battery;
  return Boolean(
    unlock &&
    typeof unlock === "object" &&
    "declaredByProvider" in unlock &&
    "executableByOyi" in unlock &&
    battery &&
    typeof battery === "object" &&
    "readableByOyi" in battery
  );
}

export async function getSmartAccessProfileForDevice(device: any, options: { refresh?: boolean; source?: string; stateRow?: any | null } = {}) {
  if (options.refresh) return persistSmartAccessSnapshot(device, { source: options.source || "manual_refresh", stateRow: options.stateRow || null });
  const current = record(device?.metadata?.smart_access);
  if (current?.capabilities && hasCapabilityEvidenceModel(current.capabilities)) {
    const profile = buildSmartAccessProfile(device, options.stateRow || null);
    return {
      ...profile,
      capabilities: current.capabilities,
      state: {
        ...(record(current.state)),
        ...(record(profile.state)),
      },
      supported_controls: smartAccessSupportedControls(current.capabilities),
      raw_fingerprint: current.raw_fingerprint || profile.raw_fingerprint,
    };
  }
  return persistSmartAccessSnapshot(device, { source: options.source || "first_read", stateRow: options.stateRow || null });
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
