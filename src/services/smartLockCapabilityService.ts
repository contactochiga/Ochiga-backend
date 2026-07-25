import { summarizeDeviceFrontendContract } from "../device/runtime/deviceStateEnrichment";

function clean(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

const LOCK_CATEGORY_HINTS = new Set([
  "jtmspro",
  "jtmsbh",
  "jtms",
  "doorlock",
  "door_lock",
  "smart_lock",
  "lock",
]);

export function summarizeSmartLockCapabilities(device: any, stateRow?: any | null) {
  const summary = summarizeDeviceFrontendContract(device || {}, stateRow || null);
  const family = clean(summary.device_family);
  const profile = clean(summary.control_profile);
  const category = clean(device?.metadata?.raw?.category || device?.metadata?.category || device?.category || device?.type);
  const capabilityCodes = new Set((summary.capability_codes || []).map((item: any) => clean(item)).filter(Boolean));
  const controls = new Set((summary.supported_controls || []).map((item: any) => clean(item)).filter(Boolean));
  const functions = [
    ...(Array.isArray(device?.metadata?.functions) ? device.metadata.functions : []),
    ...(Array.isArray(device?.metadata?.raw?.functions) ? device.metadata.raw.functions : []),
  ];
  for (const fn of functions) {
    if (fn?.code) capabilityCodes.add(clean(fn.code));
  }

  const isLock =
    family === "lock" ||
    profile === "lock" ||
    LOCK_CATEGORY_HINTS.has(category) ||
    Array.from(capabilityCodes).some((code) => /lock|door|unlock|temporary|password|fingerprint|tamper|hijack|battery/.test(code));

  const canRemoteLock =
    isLock &&
    (
      controls.has("lock") ||
      controls.has("remote_lock") ||
      capabilityCodes.has("remote_lock") ||
      capabilityCodes.has("lock") ||
      capabilityCodes.has("switch")
    );
  const canRemoteUnlock =
    isLock &&
    (
      controls.has("unlock") ||
      controls.has("remote_unlock") ||
      capabilityCodes.has("remote_unlock") ||
      capabilityCodes.has("unlock") ||
      capabilityCodes.has("lock") ||
      capabilityCodes.has("switch")
    );

  return {
    is_lock: isLock,
    device_family: isLock ? "lock" : summary.device_family,
    control_profile: isLock ? "lock" : summary.control_profile,
    can_remote_lock: canRemoteLock,
    can_remote_unlock: canRemoteUnlock,
    supported_controls: Array.from(new Set([
      ...(summary.supported_controls || []),
      ...(isLock ? ["lock_state", canRemoteLock ? "lock" : null, canRemoteUnlock ? "unlock" : null] : []),
    ].filter(Boolean) as string[])),
    capability_codes: Array.from(capabilityCodes),
  };
}

export function assertSmartLockCommandAllowed(device: any, command: Record<string, any>) {
  const lock = summarizeSmartLockCapabilities(device);
  if (!lock.is_lock) return;
  const value = String(command?.lock ?? command?.locked ?? command?.state ?? command?.switch ?? "").toLowerCase();
  const wantsUnlock = value === "false" || value === "unlocked" || value === "unlock" || command?.unlock === true;
  const wantsLock = value === "true" || value === "locked" || value === "lock" || command?.lock === true || command?.locked === true;
  if (wantsUnlock && !lock.can_remote_unlock) {
    const error: any = new Error("Remote unlock is not supported by this lock.");
    error.statusCode = 400;
    throw error;
  }
  if (wantsLock && !lock.can_remote_lock) {
    const error: any = new Error("Remote lock is not supported by this lock.");
    error.statusCode = 400;
    throw error;
  }
}
